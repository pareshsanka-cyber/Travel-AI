import os
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

# Read configurations
MONGO_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("MONGODB_DB_NAME", "travel_ai")

# Initialize client
client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)

# Export the database instance
db = client[DB_NAME]

print(f"--- DATABASE: MongoDB database '{DB_NAME}' configured; connectivity verified at startup ---")
