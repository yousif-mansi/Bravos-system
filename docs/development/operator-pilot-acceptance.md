# Operator pilot acceptance record

Blank form for a real operator pilot. Preparing it on 2026-10-11 (Cairo) against source `2a59cdab860dced680944ae5fbb042498eabc1e8` does not mean that source was piloted. The operator fills the tested build identity. Execution and sign-off stay empty until a person runs the pilot. An empty cell is not a pass.

Use this record with the [operator guide](operator-handover.md), [release rehearsal](release-rehearsal.md), and [staged restore](backups/restore.md). It does not replace those procedures.

## Identity

| Item | Value |
| --- | --- |
| Tested source / build identity | |
| Named operator | |
| Named backup operator | |
| Backup identity and where it is stored (do not write the password) | |
| Separate media-copy location | |
| Fixture (products, branch, references) | |
| Date and time (Cairo) | |
| Device and operating system | |
| Browser and version | |

## Scenarios

The expected column restates the accepted rule. Actual, evidence, and blocker are filled only from the pilot.

| Scenario | Expected | Actual | Evidence | Blocker |
| --- | --- | --- | --- | --- |
| Cash, manual online, and split tender | A physical sale stores the cash amount, the manual wallet or InstaPay amount, or both when split. Tender does not change merchandise revenue. The completed sale stays final. | | | |
| Offline sale, reconnect, and queue | An already signed-in employee completes the sale offline. The queue remains on that device and submits once on reconnect, with the original branch, employee, prices, and tender. | | | |
| Whole-order single-branch confirmation and reversal | One authorized branch supplies the whole basket. Confirmation deducts that branch once and recognizes the sale. Cancellation or failed delivery of a confirmed order reverses recognition once; stock remains unavailable until physical receipt and inspection restore only sellable quantities. A pending request holds no stock. | | | |
| Return received at the other branch | Find the original transaction by phone or readable reference and check the 14-day window from receipt. Suggest the amount actually paid; the manager chooses the actual refund and records Owed/Paid. A sellable unit is restocked once at the receiving branch. The original batch cost remains, and the sale stays attributed to the original branch and employee. | | | |
| Encrypted business backup and separate media copy | The encrypted business archive is downloaded and stored outside the browser. Product images are copied from the media directory to a separate destination. The archive has references, not image files, passwords, sessions, or recovery tokens. | | | |
| Fresh-target restore, owner recovery, and queued sales once | A target that has only the first-run owner and defaults loads the archive as it is. The owner recovers through the separate recovery path and resets staff passwords. Each eligible retained or queued sale is recovered once; preserve and resolve unsupported cases under the staged restore guide without silently discarding them or claiming automatic recovery. | | | |

## Sign-off

| Item | Value |
| --- | --- |
| Owner decision (accept or reject) | |
| Signer | |
| Date (Cairo) | |
| Notes | |
