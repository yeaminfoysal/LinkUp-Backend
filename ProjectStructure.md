# NexChat — Project Structure

```
src
├── main.ts
├── app.module.ts
│
├── common
│   ├── decorators
│   │   ├── current-user.decorator.ts
│   │   └── public.decorator.ts
│   ├── guards
│   │   ├── jwt-auth.guard.ts
│   │   ├── ws-jwt.guard.ts
│   │   └── roles.guard.ts
│   ├── filters
│   │   ├── http-exception.filter.ts
│   │   └── ws-exception.filter.ts
│   ├── interceptors
│   │   └── transform.interceptor.ts
│   ├── pipes
│   │   └── validation.pipe.ts
│   ├── enums
│   │   ├── message-type.enum.ts
│   │   ├── conversation-type.enum.ts
│   │   └── notification-type.enum.ts
│   └── utils
│       └── pagination.util.ts
│
├── config
│   ├── env.config.ts
│   ├── socket.config.ts
│   └── cloudinary.config.ts
│
├── prisma
│   ├── prisma.module.ts
│   ├── prisma.service.ts
│   └── schema.prisma
│
├── auth
│   ├── auth.module.ts
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── dto
│   │   ├── register.dto.ts
│   │   ├── login.dto.ts
│   │   └── refresh-token.dto.ts
│   ├── strategies
│   │   ├── jwt.strategy.ts
│   │   └── refresh.strategy.ts
│   └── interfaces
│       └── jwt-payload.interface.ts
│
├── users
│   ├── users.module.ts
│   ├── users.controller.ts
│   ├── users.service.ts
│   ├── dto
│   │   ├── update-user.dto.ts
│   │   └── search-user.dto.ts
│   └── entities
│       └── user.entity.ts
│
├── friends
│   ├── friends.module.ts
│   ├── friends.controller.ts
│   ├── friends.service.ts
│   ├── friends.gateway.ts
│   └── dto
│       ├── send-friend-request.dto.ts
│       └── respond-request.dto.ts
│
├── conversations
│   ├── conversations.module.ts
│   ├── conversations.controller.ts
│   ├── conversations.service.ts
│   ├── conversations.gateway.ts
│   └── dto
│       ├── create-direct.dto.ts
│       ├── create-group.dto.ts
│       └── add-members.dto.ts
│
├── messages
│   ├── messages.module.ts
│   ├── messages.controller.ts
│   ├── messages.service.ts
│   ├── messages.gateway.ts
│   └── dto
│       ├── send-message.dto.ts
│       ├── edit-message.dto.ts
│       ├── react-message.dto.ts
│       └── mark-read.dto.ts
│
├── notifications
│   ├── notifications.module.ts
│   ├── notifications.controller.ts
│   ├── notifications.service.ts
│   └── notifications.gateway.ts
│
├── uploads
│   ├── uploads.module.ts
│   ├── uploads.controller.ts
│   └── uploads.service.ts
│
└── sockets
    ├── sockets.module.ts
    ├── socket-state.service.ts
    └── socket.adapter.ts
```