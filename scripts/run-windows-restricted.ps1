#Requires -Version 7.0
<#
.SYNOPSIS
  Runs one executable under a restricted token of the current user so Windows CI
  can start an owned postgres.exe. Same user; no account or policy changes.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $FilePath,

    [Parameter()]
    [AllowEmptyCollection()]
    [string[]] $ArgumentList,

    [Parameter()]
    [string] $ArgumentsJson,

    [Parameter()]
    [string] $WorkingDirectory = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'

function Write-WrapperFailure {
    param([string] $Message)
    [Console]::Error.WriteLine("run-windows-restricted: $Message")
}

if (-not $IsWindows) {
    Write-WrapperFailure 'This wrapper runs on Windows only.'
    exit 1
}

$hasList = $PSBoundParameters.ContainsKey('ArgumentList')
$hasJson = $PSBoundParameters.ContainsKey('ArgumentsJson')
if ($hasList -and $hasJson) {
    Write-WrapperFailure 'Pass ArgumentList or ArgumentsJson, not both.'
    exit 1
}

$arguments = [string[]]::new(0)
if ($hasList) {
    foreach ($entry in $ArgumentList) {
        if ($null -eq $entry) {
            Write-WrapperFailure 'ArgumentList entries must be strings. Null is not allowed.'
            exit 1
        }
    }
    $arguments = $ArgumentList
}
elseif ($hasJson) {
    if ([string]::IsNullOrWhiteSpace($ArgumentsJson)) {
        Write-WrapperFailure 'ArgumentsJson must be a JSON array of strings.'
        exit 1
    }
    try {
        $parsed = ConvertFrom-Json -InputObject $ArgumentsJson -NoEnumerate -ErrorAction Stop
    }
    catch {
        Write-WrapperFailure 'ArgumentsJson is not valid JSON.'
        exit 1
    }
    $asList = $parsed -as [System.Collections.IList]
    if ($null -eq $asList -or $parsed -is [string]) {
        Write-WrapperFailure 'ArgumentsJson must be a JSON array of strings.'
        exit 1
    }
    $converted = [System.Collections.Generic.List[string]]::new()
    foreach ($entry in $asList) {
        if ($null -eq $entry -or $entry -isnot [string]) {
            Write-WrapperFailure 'ArgumentsJson must contain only strings. Empty strings are allowed; null, numbers, and objects are not.'
            exit 1
        }
        $converted.Add($entry)
    }
    $arguments = $converted.ToArray()
}

if ([string]::IsNullOrWhiteSpace($FilePath) -or -not [System.IO.Path]::IsPathRooted($FilePath)) {
    Write-WrapperFailure 'FilePath must be an absolute path to an existing executable.'
    exit 1
}

try {
    $applicationPath = [System.IO.Path]::GetFullPath($FilePath)
}
catch {
    Write-WrapperFailure "FilePath could not be resolved: $($_.Exception.Message)"
    exit 1
}

if (-not (Test-Path -LiteralPath $applicationPath -PathType Leaf)) {
    Write-WrapperFailure "FilePath does not exist: $applicationPath"
    exit 1
}

if ([string]::IsNullOrWhiteSpace($WorkingDirectory)) {
    Write-WrapperFailure 'WorkingDirectory is required.'
    exit 1
}

try {
    if (-not [System.IO.Path]::IsPathRooted($WorkingDirectory)) {
        $WorkingDirectory = Join-Path -Path (Get-Location).Path -ChildPath $WorkingDirectory
    }
    $workingDirectoryPath = [System.IO.Path]::GetFullPath($WorkingDirectory)
}
catch {
    Write-WrapperFailure "WorkingDirectory could not be resolved: $($_.Exception.Message)"
    exit 1
}

if (-not (Test-Path -LiteralPath $workingDirectoryPath -PathType Container)) {
    Write-WrapperFailure "WorkingDirectory does not exist: $workingDirectoryPath"
    exit 1
}

$csharp = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

namespace Bravos
{
    public static class WindowsRestrictedProcess
    {
        const uint TokenAssignPrimary = 0x0001;
        const uint TokenDuplicate = 0x0002;
        const uint TokenQuery = 0x0008;
        const uint TokenAdjustDefault = 0x0080;
        const int TokenDefaultDacl = 6;
        const int ErrorInsufficientBuffer = 122;
        const uint DisableMaxPrivilege = 0x1;
        const uint CreateSuspended = 0x00000004;
        const uint CreateNoWindow = 0x08000000;
        const int StartfUseShowWindow = 0x00000001;
        const int StartfUseStdHandles = 0x00000100;
        const short SwHide = 0;
        const int StdInputHandle = -10;
        const int StdOutputHandle = -11;
        const int StdErrorHandle = -12;
        const uint DuplicateSameAccess = 0x00000002;
        const uint GenericRead = 0x80000000;
        const uint FileShareAll = 0x00000007;
        const uint OpenExisting = 3;
        const uint FileAttributeNormal = 0x00000080;
        const int JobObjectExtendedLimitInformationClass = 9;
        const uint JobObjectLimitKillOnJobClose = 0x2000;
        const uint WaitInfinite = 0xFFFFFFFF;
        const uint WaitObject0 = 0;

        public static int Run(string applicationPath, string[] arguments, string workingDirectory)
        {
            if (string.IsNullOrWhiteSpace(applicationPath))
                throw new ArgumentException("Application path is required.", "applicationPath");
            if (string.IsNullOrWhiteSpace(workingDirectory))
                throw new ArgumentException("Working directory is required.", "workingDirectory");
            if (arguments == null)
                arguments = new string[0];
            for (int i = 0; i < arguments.Length; i++)
            {
                if (arguments[i] == null)
                    throw new ArgumentException("Arguments must be strings. Null is not allowed.", "arguments");
                if (arguments[i].IndexOf('\0') >= 0)
                    throw new ArgumentException("Arguments must not contain an embedded NUL.", "arguments");
            }

            IntPtr processToken = IntPtr.Zero;
            IntPtr restrictedToken = IntPtr.Zero;
            IntPtr adminSid = IntPtr.Zero;
            IntPtr powerUsersSid = IntPtr.Zero;
            IntPtr disableList = IntPtr.Zero;
            IntPtr job = IntPtr.Zero;
            IntPtr jobInfo = IntPtr.Zero;
            IntPtr stdin = IntPtr.Zero;
            IntPtr stdout = IntPtr.Zero;
            IntPtr stderr = IntPtr.Zero;
            IntPtr processHandle = IntPtr.Zero;
            IntPtr threadHandle = IntPtr.Zero;
            bool processCreated = false;
            bool assignedToJob = false;
            bool completed = false;

            try
            {
                if (!OpenProcessToken(
                    GetCurrentProcess(),
                    TokenQuery | TokenDuplicate | TokenAssignPrimary | TokenAdjustDefault,
                    out processToken))
                {
                    throw Win32("OpenProcessToken");
                }

                adminSid = AllocSid("S-1-5-32-544");
                powerUsersSid = AllocSid("S-1-5-32-547");
                disableList = AllocDisableList(adminSid, powerUsersSid);

                if (!CreateRestrictedToken(
                    processToken,
                    DisableMaxPrivilege,
                    2,
                    disableList,
                    0,
                    IntPtr.Zero,
                    0,
                    IntPtr.Zero,
                    out restrictedToken))
                {
                    throw Win32("CreateRestrictedToken");
                }

                EnsureCurrentUserDefaultDacl(restrictedToken);

                job = CreateJobObjectW(IntPtr.Zero, null);
                if (job == IntPtr.Zero)
                    throw Win32("CreateJobObjectW");

                jobInfo = AllocKillOnJobClose();
                int jobInfoSize = Marshal.SizeOf(typeof(JobObjectExtendedLimitInformation));
                if (!SetInformationJobObject(job, JobObjectExtendedLimitInformationClass, jobInfo, (uint)jobInfoSize))
                    throw Win32("SetInformationJobObject");

                stdin = DuplicateStandard(StdInputHandle, true);
                stdout = DuplicateStandard(StdOutputHandle, false);
                stderr = DuplicateStandard(StdErrorHandle, false);

                StartupInfoW startup = new StartupInfoW();
                startup.cb = Marshal.SizeOf(typeof(StartupInfoW));
                startup.dwFlags = StartfUseStdHandles | StartfUseShowWindow;
                startup.wShowWindow = SwHide;
                startup.hStdInput = stdin;
                startup.hStdOutput = stdout;
                startup.hStdError = stderr;

                StringBuilder commandLine = BuildCommandLine(applicationPath, arguments);
                ProcessInformation processInfo;
                if (!CreateProcessAsUserW(
                    restrictedToken,
                    applicationPath,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    true,
                    CreateSuspended | CreateNoWindow,
                    IntPtr.Zero,
                    workingDirectory,
                    ref startup,
                    out processInfo))
                {
                    throw Win32("CreateProcessAsUserW");
                }

                processCreated = true;
                processHandle = processInfo.hProcess;
                threadHandle = processInfo.hThread;

                if (!AssignProcessToJobObject(job, processHandle))
                    throw Win32("AssignProcessToJobObject");
                assignedToJob = true;

                uint resumed = ResumeThread(threadHandle);
                if (resumed == uint.MaxValue)
                    throw Win32("ResumeThread");

                uint wait = WaitForSingleObject(processHandle, WaitInfinite);
                if (wait != WaitObject0)
                    throw Win32("WaitForSingleObject");

                uint exitCode;
                if (!GetExitCodeProcess(processHandle, out exitCode))
                    throw Win32("GetExitCodeProcess");

                completed = true;
                return unchecked((int)exitCode);
            }
            finally
            {
                if (processCreated && !completed)
                {
                    if (processHandle != IntPtr.Zero)
                        TerminateProcess(processHandle, 1);
                    if (assignedToJob && job != IntPtr.Zero)
                        TerminateJobObject(job, 1);
                }

                SafeClose(ref threadHandle);
                SafeClose(ref processHandle);
                SafeClose(ref stdin);
                SafeClose(ref stdout);
                SafeClose(ref stderr);
                SafeClose(ref job);
                SafeClose(ref restrictedToken);
                SafeClose(ref processToken);
                SafeFree(ref jobInfo);
                SafeFree(ref disableList);
                SafeFree(ref adminSid);
                SafeFree(ref powerUsersSid);
            }
        }

        static void EnsureCurrentUserDefaultDacl(IntPtr token)
        {
            IntPtr info = IntPtr.Zero;
            IntPtr aclCopy = IntPtr.Zero;
            IntPtr daclStruct = IntPtr.Zero;
            WindowsIdentity identity = null;
            try
            {
                int needed;
                if (GetTokenInformation(token, TokenDefaultDacl, IntPtr.Zero, 0, out needed))
                    throw new InvalidOperationException("GetTokenInformation(TokenDefaultDacl) returned no buffer.");
                int queryError = Marshal.GetLastWin32Error();
                if (queryError != ErrorInsufficientBuffer || needed <= 0)
                    throw new Win32Exception(queryError, "GetTokenInformation(TokenDefaultDacl) failed.");

                info = Marshal.AllocHGlobal(needed);
                if (!GetTokenInformation(token, TokenDefaultDacl, info, needed, out needed))
                    throw Win32("GetTokenInformation(TokenDefaultDacl)");

                IntPtr aclPtr = Marshal.ReadIntPtr(info);
                if (aclPtr == IntPtr.Zero)
                    return;

                ushort aclSize = (ushort)Marshal.ReadInt16(aclPtr, 2);
                if (aclSize < 8)
                    throw new InvalidOperationException("Token default DACL is truncated.");

                byte[] existing = new byte[aclSize];
                Marshal.Copy(aclPtr, existing, 0, aclSize);
                RawAcl acl = new RawAcl(existing, 0);

                identity = WindowsIdentity.GetCurrent();
                SecurityIdentifier user = identity.User;
                if (user == null)
                    throw new InvalidOperationException("The current user SID is unavailable.");

                acl.InsertAce(acl.Count, new CommonAce(
                    AceFlags.ObjectInherit,
                    AceQualifier.AccessAllowed,
                    unchecked((int)0x10000000),
                    user,
                    false,
                    null));

                byte[] modified = new byte[acl.BinaryLength];
                acl.GetBinaryForm(modified, 0);
                aclCopy = Marshal.AllocHGlobal(modified.Length);
                Marshal.Copy(modified, 0, aclCopy, modified.Length);

                daclStruct = Marshal.AllocHGlobal(IntPtr.Size);
                Marshal.WriteIntPtr(daclStruct, aclCopy);
                if (!SetTokenInformation(token, TokenDefaultDacl, daclStruct, IntPtr.Size))
                    throw Win32("SetTokenInformation(TokenDefaultDacl)");
            }
            finally
            {
                if (identity != null)
                    identity.Dispose();
                SafeFree(ref info);
                SafeFree(ref aclCopy);
                SafeFree(ref daclStruct);
            }
        }

        static IntPtr AllocSid(string sddl)
        {
            SecurityIdentifier sid = new SecurityIdentifier(sddl);
            byte[] binary = new byte[sid.BinaryLength];
            sid.GetBinaryForm(binary, 0);
            IntPtr memory = Marshal.AllocHGlobal(binary.Length);
            try
            {
                Marshal.Copy(binary, 0, memory, binary.Length);
                return memory;
            }
            catch
            {
                Marshal.FreeHGlobal(memory);
                throw;
            }
        }

        static IntPtr AllocDisableList(IntPtr adminSid, IntPtr powerUsersSid)
        {
            int stride = Marshal.SizeOf(typeof(SidAndAttributes));
            IntPtr list = Marshal.AllocHGlobal(stride * 2);
            try
            {
                WriteSid(list, 0, adminSid);
                WriteSid(list, stride, powerUsersSid);
                return list;
            }
            catch
            {
                Marshal.FreeHGlobal(list);
                throw;
            }
        }

        static void WriteSid(IntPtr list, int offset, IntPtr sid)
        {
            SidAndAttributes entry = new SidAndAttributes();
            entry.Sid = sid;
            entry.Attributes = 0;
            Marshal.StructureToPtr(entry, IntPtr.Add(list, offset), false);
        }

        static IntPtr AllocKillOnJobClose()
        {
            JobObjectExtendedLimitInformation info = new JobObjectExtendedLimitInformation();
            info.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
            int size = Marshal.SizeOf(typeof(JobObjectExtendedLimitInformation));
            IntPtr memory = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(info, memory, false);
                return memory;
            }
            catch
            {
                Marshal.FreeHGlobal(memory);
                throw;
            }
        }

        static IntPtr DuplicateStandard(int standardHandle, bool allowNul)
        {
            IntPtr current = GetStdHandle(standardHandle);
            if (!IsValid(current))
            {
                if (allowNul)
                    return OpenInheritableNul();
                throw new InvalidOperationException("A required standard handle is not available.");
            }

            IntPtr duplicate;
            if (!DuplicateHandle(
                GetCurrentProcess(),
                current,
                GetCurrentProcess(),
                out duplicate,
                0,
                true,
                DuplicateSameAccess))
            {
                throw Win32("DuplicateHandle");
            }
            return duplicate;
        }

        static IntPtr OpenInheritableNul()
        {
            SecurityAttributes attributes = new SecurityAttributes();
            attributes.nLength = Marshal.SizeOf(typeof(SecurityAttributes));
            attributes.lpSecurityDescriptor = IntPtr.Zero;
            attributes.bInheritHandle = true;
            IntPtr handle = CreateFileW(
                "NUL",
                GenericRead,
                FileShareAll,
                ref attributes,
                OpenExisting,
                FileAttributeNormal,
                IntPtr.Zero);
            if (!IsValid(handle))
                throw Win32("CreateFileW(NUL)");
            return handle;
        }

        static StringBuilder BuildCommandLine(string applicationPath, string[] arguments)
        {
            StringBuilder builder = new StringBuilder();
            AppendQuoted(builder, applicationPath);
            for (int i = 0; i < arguments.Length; i++)
            {
                builder.Append(' ');
                AppendQuoted(builder, arguments[i]);
            }
            if (builder.Length >= 32767)
                throw new InvalidOperationException("The command line exceeds the Windows limit.");
            builder.Capacity = builder.Length + 1;
            return builder;
        }

        static void AppendQuoted(StringBuilder builder, string value)
        {
            bool quote = value.Length == 0
                || value.IndexOf(' ') >= 0
                || value.IndexOf('\t') >= 0
                || value.IndexOf('\n') >= 0
                || value.IndexOf('\v') >= 0
                || value.IndexOf('"') >= 0;
            if (!quote)
            {
                builder.Append(value);
                return;
            }

            builder.Append('"');
            int slashes = 0;
            for (int i = 0; i < value.Length; i++)
            {
                char ch = value[i];
                if (ch == '\\')
                {
                    slashes++;
                    continue;
                }
                if (ch == '"')
                {
                    builder.Append('\\', (slashes * 2) + 1);
                    builder.Append('"');
                    slashes = 0;
                    continue;
                }
                if (slashes > 0)
                {
                    builder.Append('\\', slashes);
                    slashes = 0;
                }
                builder.Append(ch);
            }
            if (slashes > 0)
                builder.Append('\\', slashes * 2);
            builder.Append('"');
        }

        static bool IsValid(IntPtr handle)
        {
            return handle != IntPtr.Zero && handle != new IntPtr(-1);
        }

        static void SafeClose(ref IntPtr handle)
        {
            IntPtr current = handle;
            handle = IntPtr.Zero;
            if (IsValid(current))
                CloseHandle(current);
        }

        static void SafeFree(ref IntPtr memory)
        {
            IntPtr current = memory;
            memory = IntPtr.Zero;
            if (current != IntPtr.Zero)
                Marshal.FreeHGlobal(current);
        }

        static Win32Exception Win32(string operation)
        {
            return new Win32Exception(Marshal.GetLastWin32Error(), operation + " failed.");
        }

        [StructLayout(LayoutKind.Sequential)]
        struct SidAndAttributes
        {
            public IntPtr Sid;
            public uint Attributes;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct SecurityAttributes
        {
            public int nLength;
            public IntPtr lpSecurityDescriptor;
            public bool bInheritHandle;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct StartupInfoW
        {
            public int cb;
            public IntPtr lpReserved;
            public IntPtr lpDesktop;
            public IntPtr lpTitle;
            public int dwX;
            public int dwY;
            public int dwXSize;
            public int dwYSize;
            public int dwXCountChars;
            public int dwYCountChars;
            public int dwFillAttribute;
            public int dwFlags;
            public short wShowWindow;
            public short cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct ProcessInformation
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public int dwProcessId;
            public int dwThreadId;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JobObjectBasicLimitInformation
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct IoCounters
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JobObjectExtendedLimitInformation
        {
            public JobObjectBasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("advapi32.dll", SetLastError = true, ExactSpelling = true)]
        static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

        [DllImport("advapi32.dll", SetLastError = true, ExactSpelling = true)]
        static extern bool GetTokenInformation(
            IntPtr TokenHandle,
            int TokenInformationClass,
            IntPtr TokenInformation,
            int TokenInformationLength,
            out int ReturnLength);

        [DllImport("advapi32.dll", SetLastError = true, ExactSpelling = true)]
        static extern bool SetTokenInformation(
            IntPtr TokenHandle,
            int TokenInformationClass,
            IntPtr TokenInformation,
            int TokenInformationLength);

        [DllImport("advapi32.dll", SetLastError = true, ExactSpelling = true)]
        static extern bool CreateRestrictedToken(
            IntPtr ExistingTokenHandle,
            uint Flags,
            uint DisableSidCount,
            IntPtr SidsToDisable,
            uint DeletePrivilegeCount,
            IntPtr PrivilegesToDelete,
            uint RestrictedSidCount,
            IntPtr SidsToRestrict,
            out IntPtr NewTokenHandle);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
        static extern bool CreateProcessAsUserW(
            IntPtr hToken,
            string lpApplicationName,
            StringBuilder lpCommandLine,
            IntPtr lpProcessAttributes,
            IntPtr lpThreadAttributes,
            bool bInheritHandles,
            uint dwCreationFlags,
            IntPtr lpEnvironment,
            string lpCurrentDirectory,
            ref StartupInfoW lpStartupInfo,
            out ProcessInformation lpProcessInformation);

        [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
        static extern IntPtr GetCurrentProcess();

        [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
        static extern IntPtr GetStdHandle(int nStdHandle);

        [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
        static extern bool DuplicateHandle(
            IntPtr hSourceProcessHandle,
            IntPtr hSourceHandle,
            IntPtr hTargetProcessHandle,
            out IntPtr lpTargetHandle,
            uint dwDesiredAccess,
            bool bInheritHandle,
            uint dwOptions);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
        static extern IntPtr CreateFileW(
            string lpFileName,
            uint dwDesiredAccess,
            uint dwShareMode,
            ref SecurityAttributes lpSecurityAttributes,
            uint dwCreationDisposition,
            uint dwFlagsAndAttributes,
            IntPtr hTemplateFile);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
        static extern IntPtr CreateJobObjectW(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
        static extern bool SetInformationJobObject(
            IntPtr hJob,
            int JobObjectInformationClass,
            IntPtr lpJobObjectInformation,
            uint cbJobObjectInformationLength);

        [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
        static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
        static extern uint ResumeThread(IntPtr hThread);

        [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
        static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

        [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
        static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

        [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
        static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

        [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
        static extern bool TerminateJobObject(IntPtr hJob, uint uExitCode);

        [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
        static extern bool CloseHandle(IntPtr hObject);
    }
}
'@

if (-not ('Bravos.WindowsRestrictedProcess' -as [type])) {
    Add-Type -TypeDefinition $csharp -Language CSharp -ErrorAction Stop
}

try {
    $exitCode = [Bravos.WindowsRestrictedProcess]::Run($applicationPath, $arguments, $workingDirectoryPath)
}
catch {
    Write-WrapperFailure $_.Exception.Message
    exit 1
}

# A nonzero child status is the native result, not a wrapper error.
$Error.Clear()
exit $exitCode
