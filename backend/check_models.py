"""
Fetch and print OpenRouter's available models. Use this to pick a model when
the default is rate-limited (e.g. 429). Run from backend folder:
  python check_models.py
  python check_models.py --free   # only free-tier models
"""
import os
import sys
import json
import requests
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.getenv("OPENROUTER_API_KEY")
if not API_KEY:
    print("Set OPENROUTER_API_KEY in backend/.env")
    sys.exit(1)

def main():
    only_free = "--free" in sys.argv
    url = "https://openrouter.ai/api/v1/models"
    r = requests.get(url, headers={"Authorization": f"Bearer {API_KEY}"}, timeout=30)
    r.raise_for_status()
    data = r.json()
    models = data.get("data") if isinstance(data, dict) else data
    if not models:
        print("No models in response:", data)
        return

    print(f"Total models: {len(models)}\n")
    print(f"{'ID':<55} {'Pricing':<12} {'Context'}")
    print("-" * 85)

    for m in models:
        mid = m.get("id", "")
        pricing = m.get("pricing", {}) or {}
        prompt = pricing.get("prompt") or 0
        completion = pricing.get("completion") or 0
        # Free if pricing is 0 or model id ends with :free
        free = (prompt == 0 and completion == 0) or (mid and ":free" in mid)
        if only_free and not free:
            continue
        price_str = "FREE" if free else f"${prompt}/${completion}"
        context = m.get("context_length") or "-"
        print(f"{mid:<55} {price_str:<12} {context}")

    if only_free:
        print("\n(Only free-tier models shown. Run without --free to see all.)")
    else:
        print("\nTo use a model, set OPENROUTER_MODEL in .env or change 'model' in main.py.")
        print("Free-only: python check_models.py --free")

if __name__ == "__main__":
    main()
