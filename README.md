# TruthLens

TruthLens is an app for claim verification workflows. Users submit a claim, the API evaluates supporting/contradicting evidence, stores the analysis in MongoDB, and renders results on the dashboard and history views.

## Features

- End-to-end claim flow: `/` -> `POST /api/facts` -> `/dashboard?claimId=...`
- MongoDB-backed persistence for claim analyses
- Dashboard with verdict, confidence score, evidence graph, and source cards
- History archive sourced from saved claim records
- Clerk auth-ready layout and top navigation
- Optional NewsAPI enrichment for external source discovery

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
  "claim": {
    "id": "...",
    "claim": "...",
    "verdict": "Likely True",
    "confidence": 87,
    "analysisSummary": "...",
    "tags": ["Economy"],
    "sourceNodes": []
  }
}
```

### `GET /api/facts`

Returns latest claim analysis.

### `GET /api/facts?claimId=<id>`

Returns one claim analysis by MongoDB id.

### `GET /api/facts?history=1`

Returns a list of historical claim summaries.

## Scripts

- `npm run dev` - development server
- `npm run build` - production build
- `npm run start` - production server
- `npm run lint` - eslint checks
