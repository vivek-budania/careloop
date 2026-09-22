import json
import os
import unittest
from unittest.mock import patch

from backend.careloop import coverage
from backend.prompts import COST_ESTIMATE_SYSTEM_PROMPT


def _seed_plan(*, copay_pcp=30, copay_specialist=50, deductible_remaining=500, coinsurance_pct=20):
    coverage.bind_user("visit-cost-desynpuf")
    coverage.reset()
    state = coverage._ensure_state()
    state["profile"] = {
        "zip": "94110",
        "payer_name": "Aetna",
        "plan_type": "PPO",
    }
    state["eligibility"] = {
        "status": "active",
        "plan_type": "PPO",
        "network_name": "PPO Gold Plan",
        "estimated_copay_pcp": copay_pcp,
        "estimated_copay_specialist": copay_specialist,
        "deductible_remaining": deductible_remaining,
        "coinsurance_pct": coinsurance_pct,
    }


def _clear_xai_key():
    return patch.dict(os.environ, {"XAI_API_KEY": ""}, clear=False), (
        patch("backend.llm.XAI_API_KEY", ""),
        patch("backend.config.XAI_API_KEY", ""),
    )


class VisitCostDesynpufTests(unittest.TestCase):
    def test_committed_extract_matches_fee_schedule_codes(self):
        extract = coverage._desynpuf_extract()
        meta = extract["metadata"]
        self.assertIn("synthetic", meta["license"].lower())
        self.assertIn("not a current", meta["license"].lower())
        self.assertEqual(
            [item["file_name"] for item in meta["files"]],
            [
                "DE1_0_2008_to_2010_Carrier_Claims_Sample_1A.zip",
                "DE1_0_2008_to_2010_Carrier_Claims_Sample_1B.zip",
            ],
        )
        self.assertEqual(meta["columns"]["claim_start_date"], "CLM_FROM_DT")
        self.assertIn("LINE_ALOWD_CHRG_AMT_1", meta["columns"]["line_allowed_charge"])
        self.assertIn("HCPCS_CD_1", meta["columns"]["hcpcs"])
        self.assertEqual(meta["codes_without_rows"], [])
        for code in coverage._fee_schedule():
            row = extract["codes"][code]
            self.assertGreater(row["n"], 0)
            self.assertLessEqual(row["p25"], row["median"])
            self.assertLessEqual(row["median"], row["p75"])
            year_n = sum(row["by_year"][year]["n"] for year in ("2008", "2009", "2010"))
            self.assertEqual(year_n, row["n"])

    def test_fixture_fallback_when_no_xai_key(self):
        _seed_plan()
        env, extra = _clear_xai_key()
        with env, extra[0], extra[1], patch(
            "backend.careloop.coverage.generate_json"
        ) as generate_json:
            snapshot = coverage.visit_guess(symptoms="follow up visit")
        generate_json.assert_not_called()
        estimate = snapshot["visit_cost_estimate"]
        self.assertEqual(estimate["pricing_source"], "fixture")
        self.assertNotIn("DE-SynPUF", estimate["disclaimer"])
        self.assertNotIn("CMS", estimate["disclaimer"])
        line = estimate["likely_visits"][0]
        self.assertEqual(line["code"], "99213")
        self.assertEqual(line["allowed_source"], "fixture")
        self.assertEqual(line["allowed"], 150)
        self.assertEqual(line["patient_owes_low"], 30)
        self.assertEqual(line["patient_owes_high"], 30)

    def test_grok_payload_uses_desynpuf_figures_without_calling_model(self):
        _seed_plan()
        office = coverage._desynpuf_code_stats("99214")
        lab = coverage._desynpuf_code_stats("83036")
        captured = {}

        def fake_generate(system_prompt, user_message, media=None, allow_groq_fallback=True):
            captured["system"] = system_prompt
            captured["user"] = user_message
            captured["allow_groq_fallback"] = allow_groq_fallback
            return json.dumps(
                {
                    "visit_prices": [
                        {
                            "code": "99214",
                            "allowed_low": office["p25"],
                            "allowed_high": office["p75"],
                            "note": "overall p25 to p75",
                        },
                        {
                            "code": "83036",
                            "allowed_low": lab["p25"],
                            "allowed_high": lab["p75"],
                            "note": "overall p25 to p75",
                        },
                    ]
                }
            )

        with patch("backend.careloop.coverage._xai_cost_configured", return_value=True), patch(
            "backend.careloop.coverage.generate_json", side_effect=fake_generate
        ) as generate_json:
            snapshot = coverage.visit_guess(symptoms="diabetes a1c follow up")

        generate_json.assert_called_once()
        self.assertIs(captured["system"], COST_ESTIMATE_SYSTEM_PROMPT)
        self.assertNotIn("general knowledge", captured["system"].lower())
        self.assertIn("ONLY the DE-SynPUF dollar figures", captured["system"])
        self.assertFalse(captured["allow_groq_fallback"])
        user_message = captured["user"]
        self.assertIn("DE1_0_2008_to_2010_Carrier_Claims_Sample_1A.zip", user_message)
        self.assertIn("LINE_ALOWD_CHRG_AMT", user_message)
        for stats in (office, lab):
            self.assertIn(f"p25={float(stats['p25']):.2f}", user_message)
            self.assertIn(f"median={float(stats['median']):.2f}", user_message)
            self.assertIn(f"p75={float(stats['p75']):.2f}", user_message)
            self.assertIn(f"n={int(stats['n'])}", user_message)
        for year in ("2008", "2009", "2010"):
            self.assertIn(year, user_message)

        estimate = snapshot["visit_cost_estimate"]
        self.assertEqual(estimate["pricing_source"], "desynpuf")
        self.assertIn("DE-SynPUF 2008–2010", estimate["disclaimer"])
        self.assertIn("Not a bill", estimate["disclaimer"])
        self.assertIn("not current Medicare payment", estimate["disclaimer"])
        by_code = {line["code"]: line for line in estimate["likely_visits"]}

        office_line = by_code["99214"]
        self.assertEqual(office_line["allowed_source"], "desynpuf")
        self.assertEqual(office_line["patient_owes_low"], 50)
        self.assertEqual(office_line["patient_owes_high"], 50)
        self.assertEqual(
            office_line["allowed"],
            round((float(office["p25"]) + float(office["p75"])) / 2, 2),
        )
        self.assertNotEqual(office_line["patient_owes_low"], office_line["allowed"])

        lab_line = by_code["83036"]
        self.assertEqual(lab_line["allowed_source"], "desynpuf")
        self.assertEqual(lab_line["patient_owes_low"], float(lab["p25"]))
        self.assertEqual(lab_line["patient_owes_high"], float(lab["p75"]))
        self.assertLess(lab_line["patient_owes_high"], 500)

    def test_ungrounded_or_failed_grok_stays_on_fixture(self):
        _seed_plan()
        with patch("backend.careloop.coverage._xai_cost_configured", return_value=True), patch(
            "backend.careloop.coverage.generate_json",
            return_value=json.dumps(
                {"visit_prices": [{"code": "99213", "allowed_low": 99999, "allowed_high": 100000}]}
            ),
        ):
            invented = coverage.visit_guess(symptoms="follow up visit")
        estimate = invented["visit_cost_estimate"]
        self.assertEqual(estimate["pricing_source"], "fixture")
        self.assertNotIn("DE-SynPUF", estimate["disclaimer"])
        self.assertEqual(estimate["likely_visits"][0]["allowed"], 150)
        self.assertEqual(estimate["likely_visits"][0]["allowed_source"], "fixture")

        with patch("backend.careloop.coverage._xai_cost_configured", return_value=True), patch(
            "backend.careloop.coverage.generate_json", side_effect=RuntimeError("xAI down")
        ):
            failed = coverage.visit_guess(symptoms="follow up visit")
        failed_estimate = failed["visit_cost_estimate"]
        self.assertEqual(failed_estimate["pricing_source"], "fixture")
        self.assertNotIn("DE-SynPUF", failed_estimate["disclaimer"])
        self.assertEqual(failed_estimate["likely_visits"][0]["allowed"], 150)

    def test_code_without_desynpuf_rows_skips_grok_for_that_code(self):
        _seed_plan()
        office = coverage._desynpuf_code_stats("99214")
        real_stats = coverage._desynpuf_code_stats

        def stats_for(code):
            if code == "83036":
                return None
            return real_stats(code)

        captured = {}

        def fake_generate(system_prompt, user_message, media=None, allow_groq_fallback=True):
            captured["user"] = user_message
            return json.dumps(
                {
                    "visit_prices": [
                        {
                            "code": "99214",
                            "allowed_low": office["p25"],
                            "allowed_high": office["p75"],
                        },
                        {"code": "83036", "allowed_low": 45, "allowed_high": 45},
                    ]
                }
            )

        with patch("backend.careloop.coverage._xai_cost_configured", return_value=True), patch(
            "backend.careloop.coverage._desynpuf_code_stats", side_effect=stats_for
        ), patch("backend.careloop.coverage.generate_json", side_effect=fake_generate):
            snapshot = coverage.visit_guess(symptoms="diabetes a1c follow up")

        self.assertNotIn("83036", captured["user"])
        self.assertIn(f"p25={float(office['p25']):.2f}", captured["user"])
        estimate = snapshot["visit_cost_estimate"]
        self.assertEqual(estimate["pricing_source"], "mixed")
        self.assertIn("DE-SynPUF 2008–2010", estimate["disclaimer"])
        self.assertIn("demo fee schedule", estimate["disclaimer"])
        by_code = {line["code"]: line for line in estimate["likely_visits"]}
        self.assertEqual(by_code["99214"]["allowed_source"], "desynpuf")
        self.assertEqual(by_code["99214"]["patient_owes_low"], 50)
        self.assertEqual(by_code["83036"]["allowed_source"], "fixture")
        self.assertEqual(by_code["83036"]["allowed"], 45)
        self.assertEqual(by_code["83036"]["patient_owes_low"], 45)


if __name__ == "__main__":
    unittest.main()
