from fastapi import FastAPI, Request, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

load_dotenv()

app = FastAPI()

# Load eBay verification token from env or fallback
EBAY_VERIFICATION_TOKEN = os.getenv("EBAY_VERIFICATION_TOKEN")

# Allow frontend requests (update with your frontend URL if needed)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Root route
@app.get("/")
def read_root():
    return {"message": "Welcome to the Putter Price API"}

# Example data endpoint
@app.get("/putters")
def get_putters():
    return [
        {"id": 1, "name": "Odyssey White Hot", "price": 199.99, "source": "eBay"},
        {"id": 2, "name": "Scotty Cameron Newport", "price": 349.99, "source": "Golf Galaxy"},
        {"id": 3, "name": "Ping Anser", "price": 149.99, "source": "2nd Swing"},
    ]

# eBay Verification Challenge (GET)
@app.get("/ebay-webhook")
def ebay_verification(challenge_code: str = None):
    """
    eBay sends a GET with ?challenge_code=...&verification_token=...
    You must echo back the challengeResponse.
    """
    if not challenge_code:
        raise HTTPException(status_code=400, detail="Missing challenge_code")

    return {"challengeResponse": challenge_code}

# eBay Notification Webhook (POST)
@app.post("/ebay-webhook")
async def ebay_webhook(
    request: Request,
    x_ebay_verification_token: str = Header(None)
):
    # Check verification token
    if x_ebay_verification_token != EBAY_VERIFICATION_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid verification token")

    # Parse body
    body = await request.json()
    print("✅ Verified eBay Notification:", body)

    return {"status": "ok"}
