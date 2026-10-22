"""
Phase 6 — Deterministic Unit & Integration Tests for TravelAI Chatbot Intelligence,
LLM + RAG, and True Interest-Based Itinerary Personalization.

Covers all Phase 6 scenarios:
- Scenario A: Beach preference (prioritizes coastal & beach activities)
- Scenario B: Temple and heritage preference (prioritizes spiritual & historic landmarks)
- Scenario C: Luxury preference (prioritizes premium accommodation & fine dining)
- Scenario D: Multiple interests (beaches + temples + local food)
- Scenario E: No interests provided (balanced, varied, destination-appropriate mix)
- Scenario F: Follow-up preference change
- Scenario G: Travel questions and RAG ("Why is Hawa Mahal famous?", general conversation, nearby)
- Scenario H: Provider failures and graceful fallbacks
"""

import unittest
import sys
import os
from pathlib import Path
from unittest.mock import patch, MagicMock

# Ensure Backend is in sys.path
backend_root = Path(__file__).resolve().parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))

from app.ai.agents.attraction_agent import attraction_node, evaluate_attraction_priority
from app.ai.agents.hotel_agent import hotel_node
from app.ai.agents.restaurant_agent import restaurant_node
from app.ai.agents.route_agent import route_node
from app.ai.orchestrator.state import TravelState
from app.services.slot_extraction_service import analyze_user_message, merge_travel_context
from app.services.travel_guide_agent import handle_travel_guide_query
from app.ai.rag.retriever import retrieve_travel_knowledge, resolve_destination_from_query, LANDMARK_DESTINATIONS


class TestInterestPersonalization(unittest.TestCase):

    def test_scenario_a_beach_preference(self):
        """Scenario A: 5-day Goa trip with explicit Beach & Coastal preferences."""
        state = {
            "destination": "Goa",
            "origin": "Hyderabad",
            "days": 5,
            "budget": 60000.0,
            "currency": "INR",
            "interests": ["beaches", "coastal"],
            "preferences": "beaches > coastal",
            "pace": "balanced"
        }
        with patch("app.ai.agents.attraction_agent.llm.invoke", side_effect=Exception("Offline mock")):
            attr_result = attraction_node(state)
        attractions = attr_result["attractions"]
        self.assertTrue(len(attractions) >= 4, "Should discover at least 4 candidate attractions")

        # Top attractions must be dominated by beaches
        top_cats = [a.get("category", "").lower() + " " + a.get("matched_interest", "").lower() for a in attractions[:4]]
        beach_count = sum(1 for c in top_cats if "beach" in c or "coast" in c)
        self.assertTrue(beach_count >= 2, f"Top attractions should feature beaches/coastal, found: {top_cats}")

        # Route scheduling must prioritize beaches
        state["attractions"] = attractions
        state["hotels"] = [{"name": "Beach Resort Goa", "lat": 15.2993, "lon": 74.1240, "rating": "4.5"}]
        state["restaurants"] = [{"name": "Fisherman Wharf", "lat": 15.1740, "lon": 73.9480, "rating": "4.7"}]
        route_result = route_node(state)
        day_routes = route_result["route_details"]["day_by_day_route"]

        scheduled_stops = []
        for d in day_routes:
            for s in d.get("stops", []):
                if s.get("type") == "attraction":
                    scheduled_stops.append(s["name"])

        self.assertTrue(any("Beach" in name for name in scheduled_stops), "Scheduled stops must include beaches")

    def test_scenario_b_temple_heritage_preference(self):
        """Scenario B: 5-day Goa trip with explicit Temple & Heritage preferences."""
        state = {
            "destination": "Goa",
            "origin": "Hyderabad",
            "days": 5,
            "budget": 60000.0,
            "currency": "INR",
            "interests": ["temples", "heritage", "history"],
            "preferences": "temples > heritage > history",
            "pace": "balanced"
        }
        with patch("app.ai.agents.attraction_agent.llm.invoke", side_effect=Exception("Offline mock")):
            attr_result = attraction_node(state)
        attractions = attr_result["attractions"]
        
        # Verify top candidates match temples and heritage sites
        top_matches = [a.get("matched_interest", "").lower() for a in attractions[:4]]
        heritage_temple_count = sum(1 for m in top_matches if "temple" in m or "heritage" in m or "history" in m)
        self.assertTrue(heritage_temple_count >= 2, f"Expected heritage/temple dominance, got: {top_matches}")

        top_names = [a.get("name") for a in attractions[:4]]
        has_spiritual_or_heritage = any(
            any(w in name for w in ("Temple", "Basilica", "Cathedral", "Fort"))
            for name in top_names
        )
        self.assertTrue(has_spiritual_or_heritage, f"Top names should feature spiritual/heritage sites: {top_names}")

    def test_scenario_c_luxury_preference(self):
        """Scenario C: 5-day Goa trip with Luxury travel style."""
        state = {
            "destination": "Goa",
            "origin": "Hyderabad",
            "days": 5,
            "travel_style": "LUXURY",
            "budget_mode": "LUXURY",
            "budget": 200000.0,
            "currency": "INR"
        }
        hotel_res = hotel_node(state)
        primary_hotels = hotel_res["hotels"]
        self.assertTrue(len(primary_hotels) >= 1)
        top_hotel = primary_hotels[0]
        name_lower = top_hotel.get("name", "").lower()
        self.assertTrue(
            float(top_hotel.get("rating", 0) or 0) >= 4.4 or any(w in name_lower for w in ("taj", "leela", "resort", "luxury", "luxuria", "palace", "villas", "grand")),
            f"Luxury hotel should be high-rated / luxury resort: {top_hotel}"
        )

        rest_res = restaurant_node(state)
        restaurants = rest_res["restaurants"]
        self.assertTrue(len(restaurants) >= 1)
        top_rest = restaurants[0]
        self.assertTrue(
            float(top_rest.get("rating", 0) or 0) >= 4.5,
            f"Top luxury restaurant must have high rating: {top_rest}"
        )

    def test_scenario_d_multiple_interests(self):
        """Scenario D: 5-day trip with multiple interests (beaches, temples, local food)."""
        state = {
            "destination": "Goa",
            "origin": "Hyderabad",
            "days": 5,
            "interests": ["beaches", "temples", "food"],
            "preferences": "beaches > temples > food",
            "budget": 60000.0,
            "currency": "INR",
            "pace": "balanced"
        }
        with patch("app.ai.agents.attraction_agent.llm.invoke", side_effect=Exception("Offline mock")):
            attr_result = attraction_node(state)
        attractions = attr_result["attractions"]
        matched_interests = {a.get("matched_interest", "").lower() for a in attractions}
        
        has_beach = any("beach" in m for m in matched_interests)
        has_temple = any("temple" in m for m in matched_interests)
        self.assertTrue(has_beach, "Multiple interests must include beaches")
        self.assertTrue(has_temple, "Multiple interests must include temples")

    def test_scenario_e_no_interests_provided_balanced_default(self):
        """Scenario E: 5-day Goa trip with NO interests provided yields a balanced mix."""
        state = {
            "destination": "Goa",
            "origin": "Hyderabad",
            "days": 5,
            "interests": [],
            "preferences": "",
            "budget": 50000.0,
            "currency": "INR",
            "pace": "balanced"
        }
        with patch("app.ai.agents.attraction_agent.llm.invoke", side_effect=Exception("Offline mock")):
            attr_result = attraction_node(state)
        attractions = attr_result["attractions"]
        
        # When no interests are specified, attractions must cover varied distinct categories
        unique_matches = set(a.get("matched_interest", "") for a in attractions[:6])
        unique_categories = set(a.get("category", "") for a in attractions[:6])
        self.assertTrue(len(unique_matches) >= 2 or len(unique_categories) >= 2,
                        f"Default itinerary must be varied, found: matches={unique_matches}, categories={unique_categories}")

    def test_scenario_f_follow_up_preference_change(self):
        """Scenario F: User updates context preferences from balanced to beach focus."""
        initial_context = {
            "destination": "Goa",
            "days": 5,
            "preferences": [],
            "interests": []
        }
        updated = merge_travel_context(initial_context, {
            "interests": ["beaches", "watersports"],
            "travel_style": "LUXURY"
        })
        self.assertIn("beaches", updated["interests"])
        self.assertIn("watersports", updated["interests"])
        self.assertEqual(updated["travel_style"], "LUXURY")

    def test_scenario_g_hawa_mahal_rag_question(self):
        """Scenario G: 'Why is Hawa Mahal famous?' directly retrieves knowledge and destination."""
        dest = resolve_destination_from_query("Why is Hawa Mahal famous?")
        self.assertEqual(dest, "Jaipur", "Hawa Mahal must resolve to Jaipur")

        knowledge = retrieve_travel_knowledge("Why is Hawa Mahal famous?", destination="Jaipur", k=2)
        self.assertTrue(len(knowledge) > 50, "RAG should return authentic knowledge for Hawa Mahal")
        self.assertTrue("hawa mahal" in knowledge.lower(), "Retrieved knowledge must contain Hawa Mahal")

    def test_scenario_g_general_conversational_chat(self):
        """Scenario G: Non-travel question 'Can you explain something unrelated to travel?' resolves to GENERAL_CHAT."""
        mock_response = MagicMock(content='{"intent": "GENERAL_CHAT", "slots": {}, "qa_category": null}')
        with patch("app.services.slot_extraction_service.llm.invoke", return_value=mock_response):
            analysis = analyze_user_message(
                user_message="Can you explain something unrelated to travel?",
                current_context={},
                has_current_trip=False
            )
        self.assertEqual(analysis.get("intent"), "GENERAL_CHAT", "Should resolve to GENERAL_CHAT intent")

    def test_scenario_g_places_near_second_attraction(self):
        """Scenario G: 'What about places near the second attraction you suggested?' resolves proximity."""
        travel_context = {
            "destination": "Goa",
            "last_recommendations": [
                {"name": "Aguada Fort", "lat": 15.4920, "lon": 73.7737, "category": "fort"},
                {"name": "Anjuna Beach", "lat": 15.5819, "lon": 73.7429, "category": "beach"}
            ]
        }
        with patch("app.services.travel_guide_agent.llm.invoke", return_value=MagicMock(content="Here are places near Anjuna Beach")):
            with patch("app.services.travel_guide_agent.discover_nearby_osm_places", return_value=[{"name": "Curlies Shack", "lat": 15.5800, "lon": 73.7400, "category": "food"}]):
                res = handle_travel_guide_query(
                    user_message="What about places near the second attraction you suggested?",
                    travel_context=travel_context
                )
        self.assertTrue(res.get("user_location_used") or res.get("category") == "NEARBY_PLACES",
                        "Should trigger nearby search around referenced 2nd attraction")

    def test_scenario_h_graceful_rag_and_provider_failure(self):
        """Scenario H: Graceful fallback when ChromaDB or external APIs are unavailable."""
        with patch("app.ai.rag.retriever.vector_store.similarity_search", side_effect=Exception("ChromaDB offline")):
            knowledge = retrieve_travel_knowledge("Why is Hawa Mahal famous?", destination="Jaipur")
            self.assertTrue(len(knowledge) > 0, "Must fall back cleanly to local guide files")

        cand = {"name": "Mystery Spot"}
        score, rank, matched, m_type = evaluate_attraction_priority(cand, ["nature"], [])
        self.assertIsInstance(score, (int, float))
        self.assertEqual(rank, 99)


if __name__ == "__main__":
    unittest.main()
