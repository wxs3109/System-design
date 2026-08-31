#Interfaces and exceptions

## Posts

- `POST /posts`: Publish a plain text post; the request body contains `content`, and the request header must contain `Idempotency-Key`.
- `DELETE /posts/{id}`: Delete the current user's own posts.

This board does not support images, videos or editing posts.

## focus on

- `POST /follows/{userId}`: Follow a user.
- `DELETE /follows/{userId}`: Unfollow a user.

## front page

- `GET /feed`: Read the current user's attention timeline.
- Optional query parameter `cursor` specifies the page turning position.
- By default, 20 items are returned and the cursor of the next page is returned.

## Exceptions and availability rules

- Users who are not logged in cannot post, follow, unfollow or delete posts.
- Return an explicit error if the post or user does not exist.
- Deleted posts will no longer be displayed.
- Users cannot follow themselves.
- Repeated following will not generate multiple lines.
- The same `Idempotency-Key` returns to the original Post when trying to post again.
- When the same key carries different contents, `409 Conflict` is returned.
- Returns an empty list instead of an error when there are no followers or posts to display.
- The client can safely retry when the homepage fails to load.

## Simplify the convention

Login authentication, common error format, and basic permission verification are considered existing global capabilities. This version only describes the business semantics specific to News Feed.

[Return to the first version directory](README.md)
