from pymongo import MongoClient
from bson import ObjectId

client = MongoClient("mongodb://localhost:27017/")
db = client["travel_ai"]

HYD_AIRPORT_IMG = "https://images.unsplash.com/photo-1530521954074-e64f6810b32d?auto=format&fit=crop&w=800&q=80"
BOM_AIRPORT_IMG = "https://images.unsplash.com/photo-1542296332-2e4473faf563?auto=format&fit=crop&w=800&q=80"
DEL_AIRPORT_IMG = "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=800&q=80"
GEN_AIRPORT_IMG = "https://images.unsplash.com/photo-1530521954074-e64f6810b32d?auto=format&fit=crop&w=800&q=80"

HYD_HOTEL_IMG = "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80"
GOA_HOTEL_IMG = "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=800&q=80"
GEN_HOTEL_IMG = "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80"

def get_stop_image(stop, destination):
    name = (stop.get("name") or stop.get("title") or "").lower()
    stype = (stop.get("type") or "").lower()
    dest = (destination or "").lower()
    
    if stype == "airport" or "airport" in name:
        if "bom" in name or "mumbai" in name or "chhatrapati" in name:
            return BOM_AIRPORT_IMG
        if "hyd" in name or "hyderabad" in name or "rajiv" in name:
            return HYD_AIRPORT_IMG
        if "del" in name or "delhi" in name or "indira" in name:
            return DEL_AIRPORT_IMG
        return GEN_AIRPORT_IMG
        
    if stype == "hotel" or "hotel" in name or "check-in" in name or "check-out" in name:
        if "hyderabad" in dest:
            return HYD_HOTEL_IMG
        if "goa" in dest:
            return GOA_HOTEL_IMG
        return GEN_HOTEL_IMG
        
    return None

updated_trips = 0
for t in db.trips.find():
    trip_id = t["_id"]
    dest = t.get("destination", "")
    changed = False

    # 1. Update hotels in trip
    hotels = t.get("hotels", [])
    if hotels:
        for h in hotels:
            if not h.get("imageUrl") and not h.get("image_url"):
                h_img = HYD_HOTEL_IMG if "hyderabad" in dest.lower() else GEN_HOTEL_IMG
                h["imageUrl"] = h_img
                h["image_url"] = h_img
                changed = True

    # 2. Update route_details
    rd = t.get("route_details", {})
    if rd and isinstance(rd, dict):
        dbdr = rd.get("day_by_day_route", [])
        for d in dbdr:
            if not isinstance(d, dict):
                continue
            for s in d.get("stops", []):
                if isinstance(s, dict) and not s.get("image_url"):
                    new_img = get_stop_image(s, dest)
                    if new_img:
                        s["image_url"] = new_img
                        changed = True
            for a in d.get("activities", []):
                if isinstance(a, dict) and not a.get("image_url"):
                    new_img = get_stop_image(a, dest)
                    if new_img:
                        a["image_url"] = new_img
                        changed = True

    if changed:
        db.trips.update_one(
            {"_id": trip_id},
            {"$set": {
                "hotels": hotels,
                "route_details": rd
            }}
        )
        updated_trips += 1
        print(f"Updated trip {trip_id} ({dest})")

print(f"Finished. Updated {updated_trips} trips.")
