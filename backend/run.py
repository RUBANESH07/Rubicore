"""Start the backend so phones and other devices on your network can reach it.

    python run.py                 (from the backend folder)
    python backend/run.py         (from the project folder)

Listens on 0.0.0.0:8000 by default. Override with the HOST and PORT environment variables.
Use HOST=127.0.0.1 to make it reachable from this computer only.
"""
import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8000")))
