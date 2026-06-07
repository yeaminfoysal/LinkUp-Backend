<div align="left">
  <h1>🚀 LinkUp - Backend</h1>
  <p>
    The LinkUp backend is a robust, highly scalable API built with NestJS that serves as the core engine for an AI-driven professional networking platform. It integrates PostgreSQL <code>pgvector</code> and Google Gemini AI for semantic discovery, combined with a deterministic, word-overlapping "Smart Matches" engine to suggest connections based on shared profile details. Paired with an event-driven WebSocket architecture, it ensures secure, real-time communication and flawless data synchronization across the entire network.
  </p>
</div>

---

## 🌟 Core Architecture & Features

### 🧠 Dual-Engine AI Discovery System
The backend utilizes a sophisticated two-step AI pipeline to deliver highly accurate search results:
- **Vector Semantic Search:** User profiles are converted into high-dimensional (1536-dim) vector embeddings. Using **Postgres `pgvector`**, blazing-fast **Cosine Similarity** queries are performed to find contextual matches rather than just keyword matches.
- **Generative AI Match Reasoning:** Once matches are found, they are batch processed through the **Google Gemini 2.5 Flash** model to dynamically generate personalized, 1-sentence explanations of *why* the user fits the specific search criteria.

### ⚡ Deterministic "Smart Matches" Engine
In addition to vector-based semantic search, the backend runs a cost-effective, deterministic profile-matching engine:
- **Profile Field Overlap:** Matches candidate profiles by parsing and comparing words in fields such as `profession`, `location`, `university`, `department`, `skills`, `interests`, and `work_place`, filtering out generic filler terms (stop-words).
- **Rule-Based Explanation Builder:** Computes match scores out of 100% and generates precise mutual connection descriptions (e.g., *"You both study/studied at Northern University and live in Dhaka."*) without triggering external LLM APIs, ensuring zero token cost.

### ⚡ Event-Driven Real-Time Engine
A robust WebSocket architecture ensures the app feels alive and instantaneous.
- **Socket.IO Integration:** Handles bi-directional communication for instant direct messaging and group chats.
- **Live State Tracking:** User connectivity is accurately tracked to broadcast real-time "Online" and "Last Seen" statuses across the entire network.

### 🔐 Enterprise-Grade Security & Auth
The system is built with security-first principles to protect user data.
- **JWT & Passport.js:** Stateless, secure authentication flow with encrypted tokens.
- **Bcrypt Hashing:** Industry-standard password cryptography.
- **API Rate Limiting:** Built-in `Throttler` guards the expensive AI endpoints from abuse and gracefully handles API quota limits using resilient fallback strategies.

### ☁️ Scalable Media Management
- **Cloudinary Integration:** Direct-to-cloud uploading for user avatars and social feed media, ensuring the backend server remains lightweight and stateless.

---

## 🛠️ Full Project Tech Stack (Frontend & Backend)

| Category | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | **[Next.js](https://nextjs.org/)** | React Framework for production |
| **Frontend** | **[React](https://reactjs.org/)** | UI Library |
| **Frontend** | **[Tailwind CSS](https://tailwindcss.com/)** | Utility-first CSS framework for styling |
| **Frontend** | **[Zustand](https://zustand-demo.pmnd.rs/) & [TanStack Query](https://tanstack.com/query/latest)** | Global state management & server state caching |
| **Backend** | **[NestJS](https://nestjs.com/)** | Progressive Node.js framework for scalable server-side apps |
| **Backend** | **[Prisma](https://www.prisma.io/) & [PostgreSQL](https://www.postgresql.org/)** | Next-generation ORM and primary relational database |
| **AI & Search** | **[pgvector](https://github.com/pgvector/pgvector)** | Postgres extension for vector similarity search |
| **AI & Search** | **[Google Gemini AI](https://ai.google.dev/)** | Generating embeddings and dynamic match reasoning |
| **Real-Time** | **[Socket.IO](https://socket.io/)** | Real-time bidirectional event-based communication |
| **Auth**| **[Passport & JWT](https://www.passportjs.org/)** | Stateless authentication and authorization |
| **Cloud** | **[Cloudinary](https://cloudinary.com/)** | Cloud-based image and video management |

---

## 🚀 Setup & Environment Instructions

### Prerequisites
Ensure Node.js (v18+), npm, and a running PostgreSQL instance with the `pgvector` extension are installed.

### 1. Clone the Repository
```bash
git clone <repository_url>
cd LinkUp/LinkUp-Backend
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Setup Environment Variables
Create a `.env` file in the root directory and add the necessary configurations:
```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/linkup?sslmode=require"

# JWT Auth
JWT_SECRET="your_jwt_secret_key"
JWT_REFRESH_SECRET="your_refresh_secret_key"

# Gemini AI
GEMINI_API_KEY="your_google_gemini_api_key"

# Cloudinary
CLOUDINARY_CLOUD_NAME="your_cloud_name"
CLOUDINARY_API_KEY="your_api_key"
CLOUDINARY_API_SECRET="your_api_secret"
```

### 4. Setup Prisma Database
Push the schema to the database and generate the Prisma Client:
```bash
npx prisma db push
npx prisma generate
```

### 5. Run the Server
```bash
# Development watch mode
npm run start:dev
```
The API will be running at [http://localhost:3001/api/v1](http://localhost:3001/api/v1).
Access Swagger API Docs at: [http://localhost:3001/api/docs](http://localhost:3001/api/docs)

---

## 🧠 Challenges Faced

- **pgvector Support with Prisma:** Prisma currently lacks native operational support for the `pgvector` extension. Raw SQL queries (`$queryRaw` and `$executeRaw`) were utilized to calculate Cosine Similarity (`<=>`) and perform the vector filtering dynamically.
- **Handling Gemini Free Tier Quotas:** Generating match reasons for multiple users concurrently easily hit the 15 Requests Per Minute (RPM) free-tier limit of the Gemini Flash model. This was solved by creating a batched prompt structure and gracefully falling back to a default reason using a `try-catch` block when the limit was exceeded.
- **Optimizing AI Searches:** Unnecessary AI rate limit hits were prevented by aggressively filtering low-scoring raw database queries *before* passing the high-quality matches to the text-generation model.

---

## 🚀 Future Enhancements

- **📞 Video & Audio Calling Feature:** Implementing a signaling server via WebSockets to establish peer-to-peer WebRTC connections for real-time video/audio communication.
- **🔍 Redis Caching:** Introducing Redis to cache frequently searched queries and significantly speed up the vector similarity search response times.
- **🤖 Advanced RAG Features:** Implementing Retrieval-Augmented Generation to allow interactions with an AI assistant that has contextual knowledge of the entire professional network.