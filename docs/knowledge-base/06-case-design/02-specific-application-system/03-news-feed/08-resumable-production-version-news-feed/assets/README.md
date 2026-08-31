#News Feed Restorable production version architecture diagram

## Click the link to read the thumbnail

Open these pictures first when reading for the first time. Each picture has only one purpose:

1. [Post link](flows/01-post.drawio)
2. [Follow link](flows/02-follow.drawio)
3. [Home page read link](flows/03-read-feed.drawio)
4. [Unfollow link](flows/04-unfollow.drawio)

[View thumbnail table of contents and legends](flows/README.md)

## Complete architecture diagram

[Editable Draw.io overview](news-feed-large-architecture.drawio)

The file contains four pages:

1. Component overview;
2. Writing and asynchronous distribution;
3. Home page reading path;
4. Fault recovery and Reconciliation (difference checking and repair).

Color convention: blue represents synchronous service, purple represents asynchronous messages and workers, dark green represents fact database, light green represents derived index, orange represents cache, and gray represents observability.
