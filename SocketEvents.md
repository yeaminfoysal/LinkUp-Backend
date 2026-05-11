# Socket Events

তোমার chat app-এ socket events গুলো feature অনুযায়ী ভাগ করলে maintain করা easy হবে।

Mainly 5 category:

1. connection/presence
2. friend system
3. chat/conversation
4. messaging
5. group management

---

# 1. Connection / Presence Events

## Client → Server

```
disconnect_user
ping_presence
```

> `connect_user` event আলাদা লাগবে না।
> Socket connect হওয়ার সময় WsJwtGuard JWT verify করবে।
> userId সবসময় token থেকে নেওয়া হবে, client payload থেকে না।

---

## Server → Client

```
user_online
user_offline
presence_updated
```

### user_online

```json
{
  "userId": "user-2"
}
```

### user_offline

```json
{
  "userId": "user-2",
  "lastSeen": "2026-04-29T12:00:00Z"
}
```

---

# 2. Friend System Events

## Client → Server

```
send_friend_request
accept_friend_request
reject_friend_request
cancel_friend_request
remove_friend
block_user
unblock_user
```

### send_friend_request

```json
{
  "receiverId": "user-2"
}
```

### accept_friend_request

```json
{
  "requestId": "request-1"
}
```

### reject_friend_request

```json
{
  "requestId": "request-1"
}
```

### cancel_friend_request

```json
{
  "requestId": "request-1"
}
```

### remove_friend

```json
{
  "friendshipId": "friendship-1"
}
```

### block_user

```json
{
  "userId": "user-2"
}
```

### unblock_user

```json
{
  "userId": "user-2"
}
```

---

## Server → Client

```
friend_request_received
friend_request_accepted
friend_request_rejected
friend_request_cancelled
friend_removed
user_blocked
user_unblocked
```

### friend_request_received

```json
{
  "requestId": "req-1",
  "sender": {
    "id": "user-1",
    "name": "Rahim",
    "username": "rahim123",
    "avatar": "https://..."
  }
}
```

### friend_request_accepted

```json
{
  "requestId": "req-1",
  "acceptedBy": {
    "id": "user-2",
    "name": "Karim",
    "username": "karim456",
    "avatar": "https://..."
  }
}
```

---

# 3. Conversation Events

> `create_direct_conversation` এবং `create_group_conversation` REST API তে থাকবে।
> Create হওয়ার পর server `conversation_created` emit করবে।
> `get_conversations` ও REST API তে থাকবে।

## Client → Server

```
join_conversation
leave_conversation
```

### join_conversation

socket room join করার জন্য।

```json
{
  "conversationId": "conv-1"
}
```

### leave_conversation

```json
{
  "conversationId": "conv-1"
}
```

---

## Server → Client

```
conversation_created
conversation_updated
conversation_left
```

### conversation_created

```json
{
  "conversation": {
    "id": "conv-1",
    "type": "DIRECT",
    "members": []
  }
}
```

### conversation_updated

```json
{
  "conversationId": "conv-1",
  "name": "New Group Name",
  "avatar": "https://..."
}
```

---

# 4. Messaging Events (most important)

## Client → Server

```
send_message
edit_message
delete_message
mark_as_read
typing_start
typing_stop
react_to_message
remove_reaction
```

> `reply_message` আলাদা event নেই।
> Reply করতে হলে `send_message` এ `replyToId` field দাও।

---

### send_message

```json
{
  "conversationId": "conv-1",
  "content": "hello",
  "type": "TEXT",
  "replyToId": null
}
```

Media message হলে:

```json
{
  "conversationId": "conv-1",
  "content": null,
  "type": "IMAGE",
  "mediaUrl": "https://cloudinary.com/...",
  "mimeType": "image/jpeg",
  "mediaSize": 204800,
  "replyToId": null
}
```

---

### edit_message

```json
{
  "messageId": "msg-1",
  "content": "updated text"
}
```

---

### delete_message

```json
{
  "messageId": "msg-1"
}
```

---

### mark_as_read

```json
{
  "conversationId": "conv-1",
  "messageId": "msg-1"
}
```

---

### typing_start

```json
{
  "conversationId": "conv-1"
}
```

---

### typing_stop

```json
{
  "conversationId": "conv-1"
}
```

---

### react_to_message

```json
{
  "messageId": "msg-1",
  "emoji": "❤️"
}
```

### remove_reaction

```json
{
  "messageId": "msg-1",
  "emoji": "❤️"
}
```

---

## Server → Client

```
new_message
message_edited
message_deleted
message_read
user_typing
user_stop_typing
message_reacted
reaction_removed
```

> `message_sent` আলাদা event নেই।
> Sender নিজেও room-এ থাকায় `new_message` পাবে।

---

### new_message

```json
{
  "message": {
    "id": "msg-1",
    "conversationId": "conv-1",
    "senderId": "user-1",
    "content": "hello",
    "type": "TEXT",
    "mediaUrl": null,
    "mimeType": null,
    "mediaSize": null,
    "replyToId": null,
    "createdAt": "2026-05-11T10:00:00Z"
  }
}
```

### message_edited

```json
{
  "messageId": "msg-1",
  "content": "updated text",
  "editedAt": "2026-05-11T10:05:00Z"
}
```

### message_deleted

```json
{
  "messageId": "msg-1",
  "conversationId": "conv-1"
}
```

### user_typing

```json
{
  "userId": "user-2",
  "conversationId": "conv-1"
}
```

### user_stop_typing

```json
{
  "userId": "user-2",
  "conversationId": "conv-1"
}
```

### message_read

```json
{
  "messageId": "msg-1",
  "readBy": "user-2",
  "readAt": "2026-05-11T10:01:00Z"
}
```

### message_reacted

```json
{
  "messageId": "msg-1",
  "userId": "user-2",
  "emoji": "❤️"
}
```

### reaction_removed

```json
{
  "messageId": "msg-1",
  "userId": "user-2",
  "emoji": "❤️"
}
```

---

# 5. Group Management Events

## Client → Server

```
add_group_members
remove_group_member
promote_to_admin
demote_admin
update_group_name
update_group_avatar
leave_group
delete_group
```

### add_group_members

```json
{
  "conversationId": "group-1",
  "memberIds": ["user-2", "user-3"]
}
```

### remove_group_member

```json
{
  "conversationId": "group-1",
  "userId": "user-2"
}
```

### promote_to_admin

```json
{
  "conversationId": "group-1",
  "userId": "user-2"
}
```

### demote_admin

```json
{
  "conversationId": "group-1",
  "userId": "user-2"
}
```

### update_group_name

```json
{
  "conversationId": "group-1",
  "name": "New Group Name"
}
```

### update_group_avatar

```json
{
  "conversationId": "group-1",
  "avatar": "https://cloudinary.com/..."
}
```

### leave_group

```json
{
  "conversationId": "group-1"
}
```

### delete_group

```json
{
  "conversationId": "group-1"
}
```

---

## Server → Client

```
group_member_added
group_member_removed
group_admin_promoted
group_admin_demoted
group_updated
group_deleted
```

### group_member_added

```json
{
  "conversationId": "group-1",
  "members": [
    {
      "id": "user-2",
      "name": "Karim",
      "username": "karim456",
      "avatar": "https://..."
    }
  ]
}
```

### group_member_removed

```json
{
  "conversationId": "group-1",
  "userId": "user-2"
}
```

### group_admin_promoted

```json
{
  "conversationId": "group-1",
  "userId": "user-2"
}
```

### group_admin_demoted

```json
{
  "conversationId": "group-1",
  "userId": "user-2"
}
```

### group_updated

```json
{
  "conversationId": "group-1",
  "name": "New Group Name",
  "avatar": "https://..."
}
```

### group_deleted

```json
{
  "conversationId": "group-1"
}
```

---

# 6. Notification Events

## Server → Client only

```
notification_received
unread_count_updated
```

### notification_received

```json
{
  "id": "notif-1",
  "type": "NEW_MESSAGE",
  "title": "Rahim",
  "body": "Hey, কেমন আছো?",
  "data": {
    "conversationId": "conv-1",
    "senderId": "user-1"
  },
  "createdAt": "2026-05-11T10:00:00Z"
}
```

### unread_count_updated

```json
{
  "conversationId": "conv-1",
  "unreadCount": 5
}
```

---

# Socket Room Structure

```
user:{userId}
conversation:{conversationId}
```

Example:

```typescript
socket.join(`user:${userId}`);
socket.join(`conversation:${conversationId}`);
```

Emit to room:

```typescript
server.to(`conversation:${id}`).emit('new_message', message);
server.to(`user:${userId}`).emit('notification_received', notification);
```

---

# Final Event List

## Client → Server

```
disconnect_user

send_friend_request
accept_friend_request
reject_friend_request
cancel_friend_request
remove_friend
block_user
unblock_user

join_conversation
leave_conversation

send_message
edit_message
delete_message
mark_as_read
typing_start
typing_stop
react_to_message
remove_reaction

add_group_members
remove_group_member
promote_to_admin
demote_admin
update_group_name
update_group_avatar
leave_group
delete_group
```

## Server → Client

```
user_online
user_offline

friend_request_received
friend_request_accepted
friend_request_rejected
friend_request_cancelled
friend_removed
user_blocked
user_unblocked

conversation_created
conversation_updated
conversation_left

new_message
message_edited
message_deleted
message_read
user_typing
user_stop_typing
message_reacted
reaction_removed

group_member_added
group_member_removed
group_admin_promoted
group_admin_demoted
group_updated
group_deleted

notification_received
unread_count_updated
```