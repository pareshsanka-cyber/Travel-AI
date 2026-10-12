from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import os
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
SUITES = {
    'phase2_1_reroute_tests.py': (10, 'ALL 10 PHASE 2.1 REGRESSION SCENARIOS PASSED'),
    'dynamic_reroute_tests.py': (14, '14/14 DYNAMIC REROUTING SCENARIOS PASSED'),
    'itinerary_engine_audit_tests.py': (6, 'ALL 6 ITINERARY ENGINE AUDIT TESTS PASSED'),
    'activity_identity_audit_tests.py': (7, '7/7 TESTS PASSED'),
}
EXCLUDED = {'.git', 'venv', 'node_modules', '__pycache__', 'chromadb_storage', 'docs', 'dist', '.vite'}


def manifest():
    result = {}
    for directory, dirs, files in os.walk(ROOT):
        dirs[:] = sorted(d for d in dirs if d not in EXCLUDED)
        for name in sorted(files):
            p = Path(directory) / name
            if name.startswith('.env') and name != '.env.example':
                continue
            data = p.read_bytes()
            result[p.relative_to(ROOT).as_posix()] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    return result


def git(*args):
    return subprocess.run(['git', '-C', str(ROOT), *args], capture_output=True, text=True, encoding='utf-8', errors='replace').stdout.strip()


def execute_suite(item):
    name, (count, marker) = item
    runtime = ROOT / 'Backend/venv/Scripts/python.exe'
    env = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONDONTWRITEBYTECODE='1')
    begin = time.perf_counter()
    command = [str(runtime), '-B', name]
    try:
        proc = subprocess.run(command, cwd=ROOT / 'Backend', env=env, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=240)
        output = proc.stdout + '\n' + proc.stderr
        return {'suite': name, 'expected_scenarios': count, 'passed': proc.returncode == 0 and marker in proc.stdout, 'exit_code': proc.returncode, 'elapsed_seconds': round(time.perf_counter() - begin, 3), 'command': 'python -B ' + name, 'working_directory': 'Backend', 'output': output}
    except subprocess.TimeoutExpired:
        return {'suite': name, 'expected_scenarios': count, 'passed': False, 'exit_code': None, 'elapsed_seconds': round(time.perf_counter() - begin, 3), 'output': 'TIMEOUT after 240 seconds'}


def main():
    before = manifest()
    info = {'audited_at_utc': datetime.now(timezone.utc).isoformat(), 'python': sys.version, 'head': git('rev-parse', 'HEAD'), 'branch': git('branch', '--show-current'), 'initial_status': git('status', '--short'), 'source_manifest': before, 'test_method': 'Original script entry points, unmodified, run as subprocesses in Backend; suites use their own mock database objects. No browser, HTTP endpoint integration, real MongoDB concurrency, or live-provider SLA certification.'}
    with ThreadPoolExecutor(max_workers=4) as pool:
        info['test_results'] = list(pool.map(execute_suite, SUITES.items()))
    after = manifest()
    info['source_changes_during_tests'] = [p for p in sorted(set(before) | set(after)) if before.get(p) != after.get(p)]
    (OUT / 'audit_evidence.json').write_text(json.dumps(info, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({'source_files': len(before), 'source_changes': info['source_changes_during_tests'], 'tests': [{k: v for k, v in r.items() if k != 'output'} for r in info['test_results']]}, indent=2))


if __name__ == '__main__':
    main()
