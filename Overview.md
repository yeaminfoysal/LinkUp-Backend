# Chatting App

# Project Name

NexChat

---

# Project Overview

**Project Type:** Real-time Chat + Social Feed Application

In this application, the user:

- can create/login account
- can search and see other users
- can send/accept/reject friend request
- can do one-to-one chat
- can create group and chat with multiple users
- can see live online status, typing indicator, read receipts
- can create posts with text, image, video
- can see a feed of posts from friends and public users
- can like, comment, and react to posts
- can control post visibility (public or friends only)
- Receive real-time notifications and messages

This application combines modern messaging with a social feed, similar to:

- WhatsApp + Facebook

---

# Main Features

## Authentication & Authorization

- User registration
- Login/logout
- JWT authentication (access token: 15m, refresh token: 7d)
- Refresh token stored in database (revoked on logout)
- Password hashing with bcrypt
- Protected routes via JwtAuthGuard
- Socket authentication via WsJwtGuard

---

## User Management

- User profile
- Update profile
- Bio
- Upload avatar (Cloudinary)
- Username search
- Online/offline status
- Last seen
- Post count on profile
- View other user's public posts from their profile

---

## Friend System

- Search users
- Send friend request
- Accept request
- Reject request
- Cancel request
- Remove friend
- Block user
- Friend list
- Incoming/outgoing requests

---

## One-to-One Chat

- Direct messaging
- Conversation list (sorted by lastMessageAt)
- Last message preview (denormalized: lastMessageId on Conversation)
- Unread message count

---

## Group Chat

- Create group
- Group avatar
- Group name
- Add/remove members
- Leave group
- Group admin role

---

## Messaging Features

- Send text message
- Image / file / audio / video message (uploaded to Cloudinary first, then mediaUrl sent in message)
- Reply message (replyToId field on Message)
- Edit message
- Delete message (soft delete: isDeleted flag, not removed from DB)
- Delete for everyone (optional)

---

## Real-Time Features

Using **Socket.IO**

- Instant messaging
- Typing indicator
- Online/offline event
- Friend request realtime events
- Seen/read receipts
- Live notifications
- Real-time like and comment events on posts

---

## Message Interaction

- Emoji reactions
- Pin message (optional)
- Message forwarding (optional)

---

## Social Feed

- Create post (text, image, video, or mixed)
- Post visibility: PUBLIC (everyone) or FRIENDS (friends only)
- Edit post
- Delete post (soft delete)
- Feed: paginated list of posts from friends + public posts
- Cursor-based pagination for feed
- Blocked users' posts are excluded from feed
- View a specific user's posts from their profile page

---

## Feed

User timeline shows:

- own posts
- friends' posts
- public posts

Feed rules:

### Public post

visible to all users

### Friends only post

visible only to friends

Feed sorting:

- newest first
- trending optional

---

## Post Interactions

- Like a post
- Unlike a post
- View who liked a post
- Add comment on a post
- Reply to a comment (parentId on comment)
- Delete own comment
- Like a comment
- Unlike a comment
- Save a post (optional)

---

## Notification System

- Notifications are always persisted to the database
- If target user is online, also emit via socket in real time
- New message notification
- Friend request notification
- Group invite notification
- Post liked notification
- Post commented notification
- Comment liked notification (optional)

---

# Tech Stack

## Backend

- **NestJS**
- **Socket.IO**
- **Prisma**
- **PostgreSQL**
- JWT auth
- bcrypt
- Cloudinary (file storage)
- class-validator (input validation)

---

# Architecture

## REST vs Socket responsibility

**REST API handles:**

- Auth (register, login, logout, refresh)
- User management
- Friend system (CRUD)
- Conversation creation
- Fetching messages, conversations, notifications
- Post CRUD
- Feed fetching
- Like, comment, save operations

**Socket.IO handles:**

- Real-time messaging
- Typing indicators
- Online/offline presence
- Read receipts
- Friend request events
- Group management events
- Notification delivery
- Real-time post like and comment events (optional)

## Socket rooms

```
user:{userId}                 → personal events (notifications, friend requests)
conversation:{conversationId} → messaging events (new message, typing, read)
```

## Socket authentication

- WsJwtGuard verifies JWT on every socket connection
- userId is always taken from the JWT token, never from client payload

---

# Database Rules

## Pagination

- Message list uses **cursor-based pagination** (not offset)
- Query param: `?cursor=messageId&limit=50`
- Feed (post list) also uses **cursor-based pagination**
- Query param: `?cursor=postId&limit=20`
- Comment list uses cursor-based pagination
- Sorted by `createdAt DESC`
- Conversation list uses offset-based pagination

## Denormalization

- `Conversation.lastMessageId` and `Conversation.lastMessageAt` are updated every time a new message is sent
- Used for fast conversation list loading and sorting

## Soft delete

- Messages are never hard deleted from DB
- `isDeleted: true` and `deletedAt` are set instead
- `deletedFor` array stores userIds for "delete for me" feature
- Posts are also soft deleted (isDeleted flag)

## Block system

- Before creating a direct conversation, check if either user has blocked the other
- Before sending a message, check block status
- Blocked users' posts are excluded from feed
- Blocked users cannot like or comment on each other's posts

## Post visibility

- PUBLIC: visible to all users
- FRIENDS: visible only to mutual friends and the post owner
- Post owner always sees their own posts regardless of visibility

---

# Response Format

All REST responses return a consistent shape via GlobalTransformInterceptor:

```json
{
  "success": true,
  "data": {},
  "message": "ok"
}
```

---

# Security

- Rate limiting applied on auth routes and post creation
- Message content sanitized against XSS before saving
- Post content sanitized against XSS before saving
- Refresh tokens revoked on logout (deleted from DB)
- All DTOs validated with class-validator
- Users can only edit or delete their own posts and comments

---

# File Upload Flow

1. Client uploads file via `POST /uploads`
2. Server validates MIME type and file size (image: max 5MB, video: max 50MB)
3. File is uploaded to Cloudinary
4. Server returns `mediaUrl`
5. For messages: client sends message with `mediaUrl`, `mimeType`, `mediaSize` fields
6. For posts: client sends post with `mediaUrls` array (multiple files supported)

---

# Database Tables

## Chat tables

```
users
refresh_tokens
friend_requests
friendships
blocked_users
conversations
conversation_members
messages
message_reads
reactions
notifications
```

## Social Feed tables

```
posts
post_likes
post_comments
post_comment_likes
saved_posts
```

Total: 16 tables