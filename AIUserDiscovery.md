### Core Idea

Imagine a user types in the search box:

`CSE student from Dhaka who likes backend development`

AI will analyze and find matching users.

**Result:**

`Rahim
- CSE Student
- Backend Developer
- Dhaka

Karim
- NestJS Developer
- CSE Student`

---

### Example Searches

Users will be able to search for:

`Find frontend developers
Find people interested in AI
Find CSE students from Bangladesh
Find people who love football
Find people interested in startups`

Every user's profile will be understood by AI as a **"meaning vector"**. When another user searches in natural language:

`"Backend developer interested in AI from Bangladesh"`

AI converts that query into a vector → compares it with every user's vector in the database → calculates a similarity score → shows ranked results.

---

### System Architecture

`User signs up / updates profile
          ↓
Generate Structured Profile Text
          ↓
OpenAI Embedding API → vector [1536 numbers]
          ↓
Save to PostgreSQL (pgvector)

──────────────────────────────────────

User searches:
"backend developer interested in AI"
          ↓
Query → OpenAI Embedding API → vector
          ↓
pgvector: cosine similarity compare
          ↓
Filter blocked users + yourself
          ↓
Similarity > 0.5 → relevant results
          ↓
Ranked results (highest score first)
          ↓
Display on Frontend`

---

### Step 1 — Structured Profile Text

Not just the bio — generate a rich text from the entire profile. This will be the input for the embedding.

**Profile fields:**

`name, bio, location,
university, department,
skills, interests,
profession, work_place`

tsx

`function buildProfileText(user: User): string {
  const parts: string[] = [];

  if (user.name)       parts.push(`Name: ${user.name}`);
  if (user.bio)        parts.push(`Bio: ${user.bio}`);
  if (user.location)   parts.push(`Location: ${user.location}`);
  if (user.university) parts.push(`University: ${user.university}`);
  if (user.department) parts.push(`Department: ${user.department}`);
  if (user.skills)     parts.push(`Skills: ${user.skills}`);
  if (user.interests)  parts.push(`Interests: ${user.interests}`);
  if (user.profession) parts.push(`Profession: ${user.profession}`);
  if (user.work_place) parts.push(`Work Place: ${user.work_place}`);

  return parts.join('\n');
}`

**Example output:**

`Name: Ariyan Hossain
Bio: Backend developer from Dhaka. Loves NestJS, Prisma, PostgreSQL.
     Interested in AI, system design, and startups.
Location: Dhaka, Bangladesh`

> The more info a user provides, the more accurate the search results will be. Encourage users to fill in their bio and other details during registration.
> 

---

### Step 2 — Embedding Generation

tsx

`// embedding.service.ts

@Injectable()
export class EmbeddingService {
  private openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small', // 1536 dimensions
        input: text,
      });
      return response.data[0].embedding;

    } catch (error) {
      // If API fails, return null
      // This user will be skipped in search — app won't crash
      console.error('Embedding generation failed:', error);
      return null;
    }
  }
}`

---

### Step 3 — Database Design

### Prisma Schema

Keep everything in the User model — no separate `user_embeddings` table. This avoids join queries and keeps things simple.

prisma

`model User {
  // ... existing fields

  // New fields
  location           String?
  university         String?
  department         String?
  skills             String?
  interests          String?
  profession         String?
  work_place         String?
  profileText        String?
  profileEmbedding   Unsupported("vector(1536)")?
  embeddingUpdatedAt DateTime?
}`

### pgvector Setup

sql

- `- Add manually in migrationCREATE EXTENSION IF NOT EXISTS vector;- Index for fast searchCREATE INDEX ON users
USING ivfflat (profile_embedding vector_cosine_ops)WITH (lists = 100);`

---

### Step 4 — When To Generate / Update Embedding

Embedding will be generated/updated on these **3 triggers:**

`1. User registration  → generate immediately if bio is provided
2. Profile update     → regenerate if any of: name, bio, location,
                        university, department, skills, interests,
                        profession, work_place changes
3. Manual trigger     → PATCH /ai/update-embedding/:userId
                        (for admin or background jobs)`

**Important:** Make embedding generation async. Don't wait for it before saving the profile — it runs in the background.

tsx

`// users.service.ts
async updateProfile(userId: string, dto: UpdateUserDto) {

  // 1. Save profile immediately (fast)
  const updated = await this.prisma.user.update({
    where: { id: userId },
    data: dto,
  });

  // 2. Update embedding in background (don't await)
  const needsEmbeddingUpdate =
    dto.bio || dto.name || dto.location ||
    dto.university || dto.department || dto.skills ||
    dto.interests || dto.profession || dto.work_place;

  if (needsEmbeddingUpdate) {
    this.aiDiscoveryService.updateUserEmbedding(userId).catch(console.error);
  }

  return updated;
}`

---

### Step 5 — Search Flow

tsx

`// ai-discovery.service.ts

async searchUsers(query: string, currentUserId: string) {

  // Step 1: Get blocked user IDs
  const blocked = await this.prisma.blockedUser.findMany({
    where: {
      OR: [
        { blockedById: currentUserId },
        { blockedUserId: currentUserId },
      ]
    }
  });
  const blockedIds = blocked.map(b =>
    b.blockedById === currentUserId ? b.blockedUserId : b.blockedById
  );

  // Step 2: Convert query to vector
  const queryVector = await this.embeddingService.generateEmbedding(query);
  if (!queryVector) throw new Error('Search temporarily unavailable');

  // Step 3: Find similar users with pgvector
  const results = await this.prisma.$queryRaw`
    SELECT
      id, name, username, avatar, bio, location,
      university, department, skills, interests,
      profession, work_place, is_online, embedding_updated_at,
      ROUND(
        (1 - (profile_embedding <=> ${queryVector}::vector)) * 100
      ) AS match_score
    FROM users
    WHERE
      id != ${currentUserId}
      AND id NOT IN (${blockedIds.length > 0 ? blockedIds : ['__none__']})
      AND profile_embedding IS NOT NULL
      AND (1 - (profile_embedding <=> ${queryVector}::vector)) > 0.5
    ORDER BY profile_embedding <=> ${queryVector}::vector
    LIMIT 20
  `;

  return results;
}`

---

### Step 6 — Match Score & Match Reason

No manual weighting (skills: 30%, location: 10%) — that's hardcoded and inaccurate. The score comes directly from cosine similarity.

`cosine similarity = 0.94  →  Match Score: 94%
cosine similarity = 0.87  →  Match Score: 87%
cosine similarity = 0.50  →  Match Score: 50% (minimum threshold)
cosine similarity = 0.30  →  filtered out`

Match reason is AI-generated:

tsx

`async generateMatchReason(
  userBio: string,
  university: string,
  department: string,
  skills: string,
  interests: string,
  profession: string,
  work_place: string,
  query: string,
  score: number
): Promise<string> {

 const response = await this.openai.chat.completions.create({
  model: 'gpt-4o-mini',
  max_tokens: 60,
  messages: [{
      role: 'user',
      content: `
        Search query: "${query}"
        User bio: "${userBio}"
        User university: "${university}"
        User department: "${department}"
        User skills: "${skills}"
        User interests: "${interests}"
        User profession: "${profession}"
        User work_place: "${work_place}"
        Match score: ${score}%

        Write a 1 sentence reason why this user matches the search.
        Be specific. Max 10 words. No filler words.
        Example: "NestJS developer with strong AI interest"
      `
    }]
  });

  return response.content[0].text.trim();
}`

---

### Backend — NestJS Module

### Folder Structure

`src/
└── ai-discovery/
    ├── ai-discovery.module.ts
    ├── ai-discovery.controller.ts
    ├── ai-discovery.service.ts
    ├── embedding.service.ts
    └── dto/
        ├── search-users.dto.ts
        └── update-embedding.dto.ts`

### API Endpoints

`POST  /ai/search-users           → Natural language user search
PATCH /ai/update-embedding/:id   → Manual embedding update (admin)`

### Rate Limiting

Embedding API calls are costly. They cannot be unlimited.

tsx

`@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiDiscoveryController {

  @Post('search-users')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // max 10 searches per minute
  async searchUsers(@Body() dto: SearchUsersDto, @CurrentUser() user: User) {
    return this.aiDiscoveryService.searchUsers(dto.query, user.id);
  }

  @Patch('update-embedding/:userId')
  @Throttle({ default: { limit: 5, ttl: 3600000 } }) // max 5 updates per hour
  async updateEmbedding(@Param('userId') userId: string) {
    return this.aiDiscoveryService.updateUserEmbedding(userId);
  }
}`

### DTO

tsx

`export class SearchUsersDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  query: string;
}`

---

### Example API Response

**Search query:** `"backend developer interested in AI from Dhaka"`

json

`[
  {
    "id": "user-1",
    "name": "Rahim Khan",
    "username": "rahim123",
    "bio": "NestJS developer. AI enthusiast. Based in Dhaka.",
    "location": "Dhaka",
    "isOnline": true,
    "matchScore": 94,
    "matchReason": "NestJS developer with strong AI interest in Dhaka"
  },
  {
    "id": "user-2",
    "name": "Karim Ahmed",
    "username": "karim456",
    "bio": "Backend engineer. System design & ML interests.",
    "location": "Chittagong",
    "isOnline": false,
    "matchScore": 81,
    "matchReason": "Backend engineer with machine learning interest"
  }
]`

---

### Frontend UI Plan

`┌─────────────────────────────────────────────┐
│  🔍 Discover People                          │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ "backend developer interested in AI"│    │
│  └─────────────────────────────────────┘    │
│                              [Search →]     │
│                                             │
│  Recent searches:                           │
│  "designer from Dhaka"                      │
│  "musician who codes"                       │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  👤  Rahim Khan              94% match  🟢  │
│      @rahim123 · Dhaka                      │
│      "NestJS developer. AI enthusiast."     │
│      ✨ NestJS developer with AI interest   │
│                                             │
│      [Add Friend]        [Message]          │
└─────────────────────────────────────────────┘`

---

### Full Flow Summary

`Registration:
  User fills name, bio, location, university,
  department, skills, interests, profession, work_place
        ↓
  buildProfileText() → structured text
        ↓
  OpenAI Embedding API → vector[1536]
        ↓
  User.profileEmbedding saved to DB

Profile Update:
  Any field changes → background embedding regenerate

Search:
  Query text
        ↓
  Rate limit check (10/min)
        ↓
  OpenAI Embedding API → query vector
        ↓
  pgvector cosine similarity
        ↓
  Filter: blocked users + similarity < 0.5
        ↓
  Generate match reason (AI)
        ↓
  Return ranked results`

---

### Tech Checklist

`✦ Enable pgvector PostgreSQL extension
✦ Add vector(1536) column in Prisma schema
✦ Create ivfflat index (fast search)
✦ Store OpenAI API key in .env
✦ Build EmbeddingService
✦ Build AiDiscoveryModule
✦ Apply rate limiting
✦ Async embedding regeneration on profile update
✦ Filter blocked users
✦ Enforce similarity threshold of 0.5
✦ Generate match reason using AI
✦ Build frontend search UI`

---

### Environment Variables