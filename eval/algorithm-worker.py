"""Execute only repository-authored fixtures supplied by the allowlisted runner.

Separate process and timeout are fault containment, not a hostile-code sandbox.
"""
import contextlib
import io
import json
import sys

task = json.load(sys.stdin)
namespace = {}
with contextlib.redirect_stdout(io.StringIO()):
    exec(compile(task["source"], "algorithm-fixture", "exec"), namespace)
    answers = []
    for args in task["inputs"]:
        before = json.dumps(args, sort_keys=True)
        try:
            value = namespace["solve"](*args)
            answers.append({"value": value, "mutated": before != json.dumps(args, sort_keys=True)})
        except Exception as error:
            answers.append({"error": type(error).__name__})
json.dump({"version": sys.version.split()[0], "answers": answers}, sys.stdout, ensure_ascii=False)
