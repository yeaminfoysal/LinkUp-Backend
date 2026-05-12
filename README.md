# Project Name

NexChat

---

# Project Overview

**Project Type:** Real-time Chat Application

In this application, the user:

- can create/login account
- can search and see other users
- can send/accept/reject friend request
- can do one-to-one chat
- can create group and chat with multiple users
- can see live online status, typing indicator, read receipts

This application is a simplified version of modern messaging platforms, similar to:

- WhatsApp
- Telegram
- Facebook Messenger

---

# Main Features

## Authentication & Authorization

- User registration
- Login/logout
- JWT authentication (access token: 15m, refresh token: 7d)
- Refresh token stored in database (revoked on logout)
- Password hashing with bcrypt
- Protected routes via JwtAuthGuard

---

## User Management

- User profile
- Update profile
- Upload avatar (Cloudinary)
- Username search
- Online/offline status
- Last seen

---

## Friend System

- Search users
- Send friend request
- Accept request
- Reject request
- Cancel request
- Remove friend
- Block user

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
- Seen/read receipts
- Live notifications

---

## Message Interaction

- Emoji reactions
- Pin message (optional)
- Message forwarding (optional)

---

## Notification System

- Notifications are always persisted to the database
- If target user is online, also emit via socket in real time
- new message notification
- Friend request notification
- Group invite notification

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

**Socket.IO handles:**
- Real-time messaging
- Typing indicators
- Online/offline presence
- Read receipts
- Friend request events
- Group management events
- Notification delivery

## Socket rooms

```
user:{userId}               → personal events (notifications, friend requests)
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
- Sorted by `createdAt DESC`
- Conversation list uses offset-based pagination

## Denormalization

- `Conversation.lastMessageId` and `Conversation.lastMessageAt` are updated every time a new message is sent
- Used for fast conversation list loading and sorting

## Soft delete

- Messages are never hard deleted from DB
- `isDeleted: true` and `deletedAt` are set instead
- `deletedFor` array stores userIds for "delete for me" feature

## Block system

- Before creating a direct conversation, check if either user has blocked the other
- Before sending a message, check block status

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

- Rate limiting applied on auth routes
- Message content sanitized against XSS before saving
- Refresh tokens revoked on logout (deleted from DB)
- All DTOs validated with class-validator

---

# File Upload Flow

1. Client uploads file via `POST /uploads`
2. Server validates MIME type and file size (image: max 5MB, video: max 50MB)
3. File is uploaded to Cloudinary
4. Server returns `mediaUrl`
5. Client sends message with `mediaUrl`, `mediaType`, `mediaSize` fields

---

# Database Tables

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

Total: 11 tables