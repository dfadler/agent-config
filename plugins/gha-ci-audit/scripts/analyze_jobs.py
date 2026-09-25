#!/usr/bin/env python3
"""
Analyze GitHub Actions jobs for a workflow run — critical path, billable minutes,
runner types, and optional name filtering.

Usage:
  # Pipe directly from gh api:
  gh api "repos/{owner}/{repo}/actions/runs/{run_id}/jobs?per_page=100" | python3 analyze_jobs.py

  # From a saved file:
  python3 analyze_jobs.py jobs.json

  # Filter to jobs whose name contains a substring:
  python3 analyze_jobs.py jobs.json --filter "Flow check"
  python3 analyze_jobs.py jobs.json --filter "yarn build"

  # Show the N longest jobs (default 10):
  python3 analyze_jobs.py jobs.json --top 20

  # Show step-level breakdown for the critical-path job:
  python3 analyze_jobs.py jobs.json --steps
"""
import json, sys, statistics, argparse, re
from datetime import datetime


def parse_dt(s):
    if not s:
        return None
    return datetime.fromisoformat(s.replace('Z', '+00:00'))


def job_duration_min(j):
    s = parse_dt(j.get('started_at'))
    e = parse_dt(j.get('completed_at'))
    if not s or not e:
        return None
    d = (e - s).total_seconds() / 60
    return d if d >= 0 else None


def classify_runner(name: str) -> str:
    if not name:
        return 'unknown'
    if re.search(r'runs-on--i-|self-hosted', name, re.I):
        return 'self-hosted'
    if re.search(r'ubuntu-|macos-|windows-', name, re.I):
        return 'github-hosted'
    return 'unknown'


def main():
    p = argparse.ArgumentParser(description='Analyze jobs for a GitHub Actions run.')
    p.add_argument('file', nargs='?', help='JSON file (omit to read from stdin)')
    p.add_argument('--filter', metavar='SUBSTR', help='Only show jobs whose name contains SUBSTR')
    p.add_argument('--top', type=int, default=10, help='Show top N longest jobs (default: 10)')
    p.add_argument('--steps', action='store_true', help='Show step breakdown for the critical-path job')
    args = p.parse_args()

    src = open(args.file) if args.file else sys.stdin
    raw = json.load(src)
    jobs = raw.get('jobs', raw) if isinstance(raw, dict) else raw

    if args.filter:
        jobs = [j for j in jobs if args.filter.lower() in j.get('name', '').lower()]
        print(f'Filtered to jobs matching "{args.filter}": {len(jobs)} jobs')
        print()

    completed = [j for j in jobs if j.get('completed_at')]
    if not completed:
        print('No completed jobs found.')
        return

    # Compute durations
    for j in completed:
        j['_dur'] = job_duration_min(j)

    with_dur = [j for j in completed if j['_dur'] is not None]

    # Critical path: jobs finishing within 30s of the pipeline end
    pipeline_end = max(parse_dt(j['completed_at']) for j in completed)
    critical = [
        j for j in completed
        if j.get('completed_at') and
        (pipeline_end - parse_dt(j['completed_at'])).total_seconds() < 30
    ]

    # Total billable minutes (sum of all job durations)
    total_job_min = sum(j['_dur'] for j in with_dur)
    wall_clock = max(j['_dur'] for j in with_dur) if with_dur else 0

    print(f'Jobs in run:  {len(completed)} completed')
    print(f'Wall-clock:   {wall_clock:.1f}m')
    print(f'Total job-min (billable estimate): {total_job_min:.1f}m  (parallelism factor: {total_job_min/wall_clock:.1f}x)' if wall_clock else '')
    print()

    # Critical path
    print(f'Critical path ({len(critical)} job(s) finishing last):')
    for j in sorted(critical, key=lambda x: -(x['_dur'] or 0)):
        runner_type = classify_runner(j.get('runner_name', ''))
        print(f'  [{runner_type}] {j["name"]}: {j["_dur"]:.1f}m  conclusion={j.get("conclusion")}')
    print()

    # Runner breakdown
    by_runner: dict[str, list[float]] = {}
    for j in with_dur:
        rt = classify_runner(j.get('runner_name', ''))
        by_runner.setdefault(rt, []).append(j['_dur'])
    print('Runner types:')
    for rt, ds in sorted(by_runner.items()):
        print(f'  {rt}: {len(ds)} jobs, {sum(ds):.1f} job-min total')
    print()

    # Top N longest jobs
    top = sorted(with_dur, key=lambda x: -x['_dur'])[:args.top]
    print(f'Top {min(args.top, len(top))} longest jobs:')
    for j in top:
        is_cp = '★ CRITICAL' if j in critical else ''
        print(f'  {j["_dur"]:6.1f}m  {j["name"]}  {is_cp}')
    print()

    # Step breakdown for critical path job(s)
    if args.steps:
        for j in critical:
            steps = j.get('steps', [])
            if not steps:
                print(f'No step data for: {j["name"]}')
                continue
            print(f'Steps for: {j["name"]}')
            for s in steps:
                sd = job_duration_min({'started_at': s.get('started_at'), 'completed_at': s.get('completed_at')})
                dur_str = f'{sd:.1f}m' if sd is not None else '—'
                print(f'  {dur_str:6s}  {s.get("name")}  ({s.get("conclusion", "?")})')
            print()


if __name__ == '__main__':
    main()
