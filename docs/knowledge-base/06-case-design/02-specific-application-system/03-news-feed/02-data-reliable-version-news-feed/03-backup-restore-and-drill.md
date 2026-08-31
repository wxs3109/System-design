# Backup, restore and drill

## Why copy is not a backup

User deletions, incorrect scripts, and application bugs are replicated to all replicas. Replicas improve availability and cannot replace historical recovery points.

## Backup composition

- Periodic full/base backup;
- Continuous WAL archive;
- Save across fault domains or regions;
- Encryption, access control and retention policies;
- Immutable or protected backup copies.

## Point-in-Time Recovery

If you run the error removal script at 10:05, you can revert to 10:04:59:

1. Restore the latest base backup in the isolation environment;
2. Replay WAL to the target time point;
3. Verify the number and constraints of Post and Follow;
4. Choose to perform a full database Restore Cutover, or restore only the affected records;
5. Retain accident audit evidence.

## Recovery walkthrough

Backup success metrics do not prove recoverability. The drill requires actual measurements:

- How long does it take to find the backup;
- How long does it take to download and restore;
- WAL is continuous;
- Whether the application can connect to the recovery library;
- Whether data constraints, sampling Post and Follow are correct;
- Whether the final RPO/RTO meets the standards.

[Return to the second version directory](README.md)
