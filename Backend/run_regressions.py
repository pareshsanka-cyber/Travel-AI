"""Run the local regression suites and fail if any suite fails."""
import re
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
suites = ['weather_tests.py', 'booking_tests.py', 'planning_error_tests.py', 'payment_tests.py', 'security_consistency_tests.py', 'activity_identity_audit_tests.py',
          'itinerary_engine_audit_tests.py', 'dynamic_reroute_tests.py', 'phase2_1_reroute_tests.py']
failed = False
for suite in suites:
    result = subprocess.run([sys.executable, str(root / suite)], cwd=root, capture_output=True,
                            text=True, encoding='utf-8', errors='replace', timeout=120)
    output = result.stdout + result.stderr
    print(f"{suite}: {'PASS' if result.returncode == 0 else 'FAIL'}")
    if result.returncode:
        print(output)
        failed = True
    else:
        summaries = [line for line in output.splitlines()
                     if re.search(r'Ran \d+ tests|AUDIT SUMMARY|RESULTS:|ALL \d+', line)]
        for summary in summaries: print('  ' + summary)
sys.exit(1 if failed else 0)
