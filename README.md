# TruthLens

TruthLens is an app for claim verification workflows. Users submit a claim, the API evaluates supporting/contradicting evidence, stores the analysis in MongoDB, and renders results on the dashboard and history views.

## Features

- End-to-end claim flow: `/` -> `POST /api/facts` -> `/dashboard?claimId=...`
- MongoDB-backed persistence across `users`, `queries`, and `results` collections
- Dashboard with verdict, confidence score, evidence graph, and source cards
- History archive sourced from saved claim records
- Clerk auth-ready layout and top navigation
- Optional NewsAPI enrichment for external source discovery
- Input deduplication cache to avoid repeated external API calls for the same claim in a short window

## Tech Stack

- Next.js
- TypeScript
- MongoDB
- Clerk
- Tailwind CSS

## Environment Variables

Refer to [.env.local](.env.example)

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## API

### `POST /api/facts`

Creates a new claim analysis.

Request body:

```json
{
  "claim": "Shipping delays in Q3 were driven by localized port strikes."
}
```

Response:

```json
{
  "claimId": "...",
  "cached": false,
  "verdict": "True",
  "explanation": "Most weighted evidence supports the claim...",
  "confidence": 82,
  "sources": [],
  "claim": {
    "id": "...",
    "claim": "...",
    "verdict": "True",
    "confidence": 87,
    "analysisSummary": "...",
    "tags": ["Economy"],
    "sourceNodes": []
  }
}
```

Verdict values are standardized to: `True`, `False`, `Mixed`, `Unknown`.

### `GET /api/facts`

Returns latest claim analysis.

### `GET /api/facts?claimId=<id>`

Returns one claim analysis by MongoDB id.

### `GET /api/facts?history=1`

Returns a list of historical claim summaries.

### `POST /api/analyze`

Canonical structured analysis endpoint. Accepts `input`, `claim`, or `url`.

Response includes:

- `id`
- `input`
- `inputType` (`text` or `url`)
- `verdict` (`True | False | Mixed | Unknown`)
- `explanation`
- `sources`
- `confidence`
- `cached`

### `GET /api/history`

Returns persisted query/result history (`limit` query param supported).

### `PUT /api/facts`

Re-runs analysis and updates an existing claim.

Request body:

```json
{
  "claimId": "...",
  "claim": "Updated claim text"
}
```

### `DELETE /api/facts?claimId=<id>`

Deletes a claim by MongoDB id.

### `GET /api/health`

Health-check endpoint for backend and database availability.

## Scripts

- `npm run dev` - development server
- `npm run build` - production build
- `npm run start` - production server
- `npm run lint` - eslint checks
