export class BackupValidationError extends Error {
  readonly code = "VALIDATION";
}

export class BackupInProgressError extends Error {
  readonly code = "CONFLICT";

  constructor() {
    super("يجري إنشاء نسخة احتياطية أخرى الآن. انتظر اكتمالها ثم حاول مرة أخرى.");
  }
}

export class BackupArchiveError extends Error {
  readonly code = "BACKUP_ARCHIVE_INVALID";
}
