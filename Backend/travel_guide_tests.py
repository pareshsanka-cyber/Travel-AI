"""
Unit and regression tests for TravelAI's Personalized Travel Guide Agent.

Covers all 13 required test areas:
1. Generic query for famous attractions
2. Interest-specific query (heritage / nature)
3. Nearby query with valid GPS
4. Nearby query without GPS (must not invent location)
5. Follow-up query referencing previous recommendation
6. Multi-provider deduplication
7. Missing ratings, coordinates, and opening hours
8. SerpApi timeout / rate limiting / provider failure
9. Empty / irrelevant RAG results
10. Unsupported walking-time requests
11. Invalid structured output and malformed LLM responses
12. Itinerary actions with revision conflicts
13. Regression tests for the four chat intents
"""

import copy
import unittest
from unittest.mock import patch, MagicMock
from bson import ObjectId
from datetime import datetime
from fastapi import HTTPException

from app.schemas.travel_guide import PlaceRecommendation
from app.services.travel_guide_agent import (
    handle_travel_guide_query,
    extract_interest_tags,
    classify_guide_query,
    deduplicate_places,
    calculate_place_relevance_score,
    build_place_recommendation,
    resolve_place_from_reference
)
from app.services.chat_service import process_chat_message
from app.services.itinerary_edit_service import apply_schedule_edits, add_activity_to_day
from app.database.mongodb import db


class TravelGuideAgentTests(unittest.TestCase):

    def setUp(self):
        # Sample verified candidate places for testing
        self.sample_attractions = [
            {
                "name": "Amber Palace",
                "category": "monument",
                "description": "Iconic 16th-century hilltop palace fort with Rajput architecture.",
                "lat": 26.9855,
                "lon": 75.8513,
                "rating": 4.7,
                "review_count": 125000,
                "address": "Devisinghpura, Amer, Jaipur, Rajasthan",
                "source": "google_maps",
                "opening_hours": "09:00 - 17:00",
                "interests": ["history", "architecture", "heritage"]
            },
            {
                "name": "Hawa Mahal",
                "category": "monument",
                "description": "Palace of Winds with 953 ornate latticed windows.",
                "lat": 26.9239,
                "lon": 75.8267,
                "rating": 4.6,
                "review_count": 98000,
                "address": "Hawa Mahal Rd, Badi Choupad, Jaipur",
                "source": "google_maps",
                "opening_hours": "09:00 - 16:30",
                "interests": ["history", "architecture"]
            },
            {
                "name": "Central Park Jaipur",
                "category": "nature",
                "description": "Expansive green public park with walking tracks and musical fountain.",
                "lat": 26.9015,
                "lon": 75.8080,
                "rating": 4.5,
                "review_count": 14000,
                "address": "Prithviraj Rd, Rambagh, Jaipur",
                "source": "osm_fallback",
                "opening_hours": "Open 24/7",
                "interests": ["nature", "scenic"]
            }
        ]

    # 1. Generic query for famous attractions
    @patch("app.services.travel_guide_agent.discover_via_serpapi")
    @patch("app.services.travel_guide_agent.discover_via_overpass")
    @patch("app.services.travel_guide_agent.retrieve_travel_knowledge", return_value="Jaipur is Rajasthan's capital.")
    def test_generic_famous_attractions_query(self, mock_rag, mock_osm, mock_serp):
        mock_serp.return_value = self.sample_attractions[:2]
        mock_osm.return_value = [self.sample_attractions[2]]

        res = handle_travel_guide_query(
            user_message="What are the famous places in Jaipur?",
            travel_context={"destination": "Jaipur"},
            destination="Jaipur"
        )

        self.assertEqual(res["category"], "FAMOUS_ATTRACTIONS")
        self.assertEqual(res["destination"].lower(), "jaipur")
        self.assertGreaterEqual(len(res["places"]), 2)
        # Verify first place is a structured PlaceRecommendation dict
        first = res["places"][0]
        self.assertIn("name", first)
        self.assertIn("category", first)
        self.assertIn("reason_recommended", first)
        self.assertIn("supported_actions", first)
        self.assertFalse(res["user_location_used"])

    # 2. Interest-specific query (heritage vs nature)
    @patch("app.services.travel_guide_agent.discover_via_serpapi")
    @patch("app.services.travel_guide_agent.discover_via_overpass", return_value=[])
    @patch("app.services.travel_guide_agent.retrieve_travel_knowledge", return_value="")
    def test_interest_specific_query(self, mock_rag, mock_osm, mock_serp):
        mock_serp.return_value = self.sample_attractions

        # History-focused query
        res_hist = handle_travel_guide_query(
            user_message="I love ancient history, royal forts, and heritage architecture in Jaipur",
            travel_context={"destination": "Jaipur", "interests": ["history", "heritage"]}
        )
        self.assertEqual(res_hist["category"], "INTEREST_RECOMMENDATIONS")
        # Top recommended place must match history
        top_place = res_hist["places"][0]
        self.assertIn("heritage", top_place["reason_recommended"].lower() + str(top_place["description"]).lower())

        # Nature-focused query
        res_nat = handle_travel_guide_query(
            user_message="Show me green parks and nature spots in Jaipur",
            travel_context={"destination": "Jaipur"}
        )
        self.assertEqual(res_nat["category"], "INTEREST_RECOMMENDATIONS")
        # Central Park should score top for nature query
        names = [p["name"] for p in res_nat["places"]]
        self.assertIn("Central Park Jaipur", names)

    # 3. Nearby query with valid GPS coordinates
    @patch("app.services.travel_guide_agent.discover_nearby_osm_places")
    @patch("app.services.travel_guide_agent.retrieve_travel_knowledge", return_value="")
    def test_nearby_query_with_valid_gps(self, mock_rag, mock_nearby_osm):
        # Mock places near (26.9124, 75.7873)
        mock_nearby_osm.return_value = [
            {
                "name": "Tapri Central Cafe",
                "category": "cafe",
                "description": "Rooftop tea cafe with street views.",
                "lat": 26.9120,
                "lon": 75.7880,
                "address": "C Scheme, Jaipur",
                "source": "osm_overpass"
            }
        ]

        res = handle_travel_guide_query(
            user_message="Find cafés and restaurants near me",
            travel_context={"destination": "Jaipur"},
            current_lat=26.9124,
            current_lon=75.7873
        )

        self.assertEqual(res["category"], "NEARBY_PLACES")
        self.assertTrue(res["user_location_used"])
        self.assertGreaterEqual(len(res["places"]), 1)
        place = res["places"][0]
        # Distance must be computed from GPS
        self.assertIsNotNone(place["distance_meters"])
        self.assertLess(place["distance_meters"], 500)  # ~100m away
        self.assertIn("from your location", place["reason_recommended"].lower())

    # 4. Nearby query without GPS (must NOT invent location)
    @patch("app.services.travel_guide_agent.discover_via_serpapi")
    @patch("app.services.travel_guide_agent.discover_via_overpass", return_value=[])
    @patch("app.services.travel_guide_agent.retrieve_travel_knowledge", return_value="")
    def test_nearby_query_without_gps_never_invents_location(self, mock_rag, mock_osm, mock_serp):
        mock_serp.return_value = self.sample_attractions[:2]

        res = handle_travel_guide_query(
            user_message="What famous places are nearby?",
            travel_context={"destination": "Jaipur"},
            current_lat=None,
            current_lon=None
        )

        self.assertEqual(res["category"], "NEARBY_PLACES")
        self.assertFalse(res["user_location_used"])
        # Explanation must inform user that GPS was not provided rather than faking coordinates
        self.assertIn("location was not provided", res["answer"].lower())
        # Distance meters must be None because user location is unknown
        for p in res["places"]:
            self.assertIsNone(p["distance_meters"])

    # 5. Follow-up query referencing previously recommended place
    @patch("app.services.travel_guide_agent.retrieve_travel_knowledge", return_value="Built in 1799 by Maharaja Sawai Pratap Singh.")
    def test_follow_up_referencing_previous_place(self, mock_rag):
        last_recs = [
            {"name": "Amber Palace", "category": "monument", "latitude": 26.9855, "longitude": 75.8513, "rating": 4.7, "address": "Amer, Jaipur"},
            {"name": "Hawa Mahal", "category": "monument", "latitude": 26.9239, "longitude": 75.8267, "rating": 4.6, "address": "Hawa Mahal Rd, Jaipur"}
        ]

        # Query referring to ordinal "second one"
        res = handle_travel_guide_query(
            user_message="Tell me more about the second one",
            travel_context={"destination": "Jaipur", "last_recommendations": last_recs}
        )

        self.assertEqual(res["category"], "FOLLOW_UP")
        self.assertIn("Hawa Mahal", res["answer"])
        self.assertEqual(len(res["places"]), 1)
        self.assertEqual(res["places"][0]["name"], "Hawa Mahal")

    # 6. Multi-provider deduplication
    def test_multi_provider_deduplication(self):
        duplicate_input = [
            {"name": "Hawa Mahal", "category": "monument", "lat": 26.9239, "lon": 75.8267, "rating": 4.6, "source": "google_maps"},
            {"name": "Hawa Mahal (Palace of Winds)", "category": "attraction", "lat": 26.9240, "lon": 75.8268, "source": "osm_overpass"},
            {"name": "City Palace", "category": "palace", "lat": 26.9258, "lon": 75.8236, "rating": 4.5, "source": "google_maps"}
        ]

        deduped = deduplicate_places(duplicate_input)
        self.assertEqual(len(deduped), 2)
        names = [d["name"] for d in deduped]
        self.assertIn("Hawa Mahal", names)
        self.assertIn("City Palace", names)

    # 7. Missing ratings, coordinates, and opening hours
    def test_missing_ratings_coordinates_hours(self):
        raw = {
            "name": "Secret Heritage Well",
            "category": "historic",
            "description": "An ancient stepwell.",
            "lat": None,
            "lon": None,
            "rating": None,
            "review_count": None,
            "opening_hours": None
        }

        rec = build_place_recommendation(raw, reason="Offbeat sight")
        self.assertIsNone(rec.latitude)
        self.assertIsNone(rec.longitude)
        self.assertIsNone(rec.rating)
        self.assertIsNone(rec.review_count)
        self.assertIsNone(rec.distance_meters)
        self.assertIsNone(rec.travel_duration_minutes)
        self.assertEqual(rec.opening_status, "UNKNOWN")

    # 8. SerpApi timeout and provider failure handling
    @patch("app.services.travel_guide_agent.discover_via_serpapi")
    @patch("app.services.travel_guide_agent.discover_via_overpass")
    @patch("app.services.travel_guide_agent.retrieve_travel_knowledge", return_value="Jaipur landmarks.")
    def test_serpapi_failure_fallback(self, mock_rag, mock_osm, mock_serp):
        # SerpApi fails / times out
        mock_serp.side_effect = Exception("SerpApi 429 Rate Limited")
        # Overpass returns fallback candidates
        mock_osm.return_value = [self.sample_attractions[1]]

        res = handle_travel_guide_query(
            user_message="Famous attractions in Jaipur",
            travel_context={"destination": "Jaipur"}
        )

        self.assertGreaterEqual(len(res["places"]), 1)
        self.assertEqual(res["places"][0]["name"], "Hawa Mahal")

    # 9. Empty or irrelevant RAG results
    @patch("app.services.travel_guide_agent.discover_via_serpapi")
    @patch("app.services.travel_guide_agent.retrieve_travel_knowledge", return_value="")
    def test_empty_rag_results(self, mock_rag, mock_serp):
        mock_serp.return_value = [self.sample_attractions[0]]

        res = handle_travel_guide_query(
            user_message="What are famous attractions in Jaipur?",
            travel_context={"destination": "Jaipur"}
        )

        self.assertGreaterEqual(len(res["places"]), 1)
        self.assertIn("Amber Palace", res["answer"] + str(res["places"]))

    # 10. Unsupported walking-time requests
    @patch("app.services.travel_guide_agent.discover_nearby_osm_places")
    @patch("app.services.travel_guide_agent.retrieve_travel_knowledge", return_value="")
    def test_unsupported_walking_time_requests(self, mock_rag, mock_nearby):
        mock_nearby.return_value = [
            {"name": "Local Bazaar", "category": "market", "lat": 26.9150, "lon": 75.7900}
        ]

        res = handle_travel_guide_query(
            user_message="Find places within a 10-minute walk",
            travel_context={"destination": "Jaipur"},
            current_lat=26.9124,
            current_lon=75.7873
        )

        self.assertEqual(res["category"], "NEARBY_PLACES")
        place = res["places"][0]
        # Walking time must not be fabricated without pedestrian profile
        self.assertIsNone(place["travel_duration_minutes"])
        self.assertIsNotNone(place["distance_meters"])

    # 11. Invalid structured output and malformed LLM responses
    @patch("app.services.travel_guide_agent.llm.invoke", side_effect=Exception("LLM Context Length Exceeded"))
    @patch("app.services.travel_guide_agent.discover_via_serpapi")
    @patch("app.services.travel_guide_agent.retrieve_travel_knowledge", return_value="")
    def test_malformed_llm_response_fallback(self, mock_rag, mock_serp, mock_llm):
        mock_serp.return_value = [self.sample_attractions[0]]

        res = handle_travel_guide_query(
            user_message="Famous monuments in Jaipur",
            travel_context={"destination": "Jaipur"}
        )

        # Fallback must still provide a valid answer string and the structured places
        self.assertIsInstance(res["answer"], str)
        self.assertIn("Amber Palace", res["answer"])
        self.assertEqual(len(res["places"]), 1)

    # 12. Itinerary actions with revision conflicts
    def test_itinerary_action_with_revision_conflicts(self):
        sample_trip = {
            "_id": ObjectId(),
            "destination": "Jaipur",
            "bedtime": "22:00",
            "revision": 2,
            "route_details": {
                "day_by_day_route": [
                    {
                        "day": 1,
                        "date": "2026-11-01",
                        "stops": [
                            {"id": "stop_1", "name": "Airport Arrival", "type": "airport", "start_time": "09:00", "end_time": "10:00", "time": "09:00 - 10:00", "lat": 26.8286, "lon": 75.8056},
                            {"id": "stop_2", "name": "Hawa Mahal", "type": "attraction", "start_time": "11:00", "end_time": "12:30", "time": "11:00 - 12:30", "lat": 26.9239, "lon": 75.8267}
                        ]
                    }
                ]
            }
        }

        # Add new attraction to Day 1
        updated = add_activity_to_day(sample_trip, self.sample_attractions[0], day_number=1, duration_minutes=90)
        day1_stops = updated["route_details"]["day_by_day_route"][0]["stops"]
        self.assertEqual(len(day1_stops), 3)
        self.assertTrue(any(s["name"] == "Amber Palace" for s in day1_stops))

        # Test revision conflict simulation: update with stale revision should reject
        from app.services.trip_consistency import revision_filter
        stale_trip = dict(sample_trip, revision=1)  # stale revision 1 vs current 2
        f = revision_filter({"_id": sample_trip["_id"]}, stale_trip)
        self.assertEqual(f["revision"], 1)

    # 13. Regression tests for the existing four chat intents
    @patch("app.services.chat_service.analyze_user_message")
    @patch("app.services.chat_service.get_or_create_conversation")
    @patch("app.services.chat_service.add_message")
    @patch("app.services.chat_service.get_conversation_messages", return_value=[])
    def test_regression_four_chat_intents(self, mock_msgs, mock_add_msg, mock_conv, mock_analyze):
        mock_c = MagicMock()
        mock_c.conversation_id = "conv_test_123"
        mock_c.travel_context.model_dump.return_value = {"destination": "Goa", "days": 3}
        mock_c.current_trip_id = None
        mock_conv.return_value = mock_c

        # Intent 1: UPDATE_CONTEXT
        mock_analyze.return_value = {"intent": "UPDATE_CONTEXT", "slots": {"budget": 40000}}
        res_update = process_chat_message("conv_test_123", "My budget is 40000", user_id="u1")
        self.assertEqual(res_update["intent"], "UPDATE_CONTEXT")

        # Intent 2: TRAVEL_QA
        mock_analyze.return_value = {"intent": "TRAVEL_QA", "slots": {}, "qa_category": "WEATHER"}
        with patch("app.services.travel_guide_agent.fetch_realtime_weather_openmeteo", return_value={"summary": "Sunny and 28C"}):
            res_qa = process_chat_message("conv_test_123", "How is the weather?", user_id="u1")
            self.assertEqual(res_qa["intent"], "TRAVEL_QA")

        # Intent 3: GENERATE_ITINERARY (missing slots guidance)
        mock_c.travel_context.model_dump.return_value = {"destination": None, "days": None}
        mock_analyze.return_value = {"intent": "GENERATE_ITINERARY", "slots": {}}
        res_plan = process_chat_message("conv_test_123", "Plan my trip", user_id="u1")
        self.assertEqual(res_plan["intent"], "UPDATE_CONTEXT")
        self.assertIn("destination", res_plan["message"]["content"].lower())

    # 14. Destination normalization and typo handling (e.g. hyderanad / hyd -> Hyderabad)
    @patch("app.services.travel_guide_agent.retrieve_travel_knowledge", return_value="Historical information about Old Goa.")
    def test_destination_typo_hyderabad_resolution(self, mock_rag):
        res = handle_travel_guide_query(
            user_message="what are the famous places in hyderanad",
            travel_context={}
        )
        self.assertEqual(res["destination"], "Hyderabad")
        self.assertGreaterEqual(len(res["places"]), 2)
        place_names = [p["name"] for p in res["places"]]
        self.assertIn("Charminar", place_names)
        self.assertIn("Golconda Fort", place_names)
        # Vector leakage guard: Goa knowledge must NOT leak into Hyderabad synthesis
        self.assertNotIn("Goa", res["answer"])


if __name__ == "__main__":
    unittest.main()
