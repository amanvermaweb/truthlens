
# TruthLens

TruthLens is a Next.js 16 app for claim verification workflows. Users submit a claim, the API evaluates supporting/contradicting evidence, stores the analysis in MongoDB, and renders results on the dashboard and history views.

## Features

- End-to-end claim flow: `/` -> `POST /api/facts` -> `/dashboard?claimId=...`
- MongoDB-backed persistence for claim analyses
- Dashboard with verdict, confidence score, evidence graph, and source cards
- History archive sourced from saved claim records
- Clerk auth-ready layout and top navigation
- Optional NewsAPI enrichment for external source discovery

## Tech Stack

- Next.js 16 (App Router)
- React 19
- TypeScript
- MongoDB Node driver
- Clerk
- Tailwind CSS 4

## Environment Variables

Create `.env.local` with:

```bash
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<db>?retryWrites=true&w=majority

# Optional: enables external source enrichment in POST /api/facts
NEWS_API_KEY=your_newsapi_key

# Clerk (if auth is enabled in your environment)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
```

`MONGODB_URI` is required. The app throws a startup error if it is missing.

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
