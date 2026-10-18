B=http://localhost:4002/v1
R=perfy/history
probe() { out=$(curl -s -o /dev/null -w "%{http_code} %{time_total}" --max-time 90 "$B$1"); out2=$(curl -s -o /dev/null -w "%{time_total}" --max-time 90 "$B$1"); printf "%-58s %s then %ss\n" "$1" "$out" "$out2"; }
FIRST=$(curl -s "$B/repos/$R/commits?limit=400" | python -c "import sys,json; d=json.load(sys.stdin); print(d[-1]['sha'])")
MID=$(curl -s "$B/repos/$R/commits?limit=400" | python -c "import sys,json; d=json.load(sys.stdin); print(d[200]['sha'])")
probe "/repos/$R"
probe "/repos/$R/tree/main"
probe "/repos/$R/tree/main?path=data"
probe "/repos/$R/commits?limit=30"
probe "/repos/$R/commits?limit=30&path=data/file-03.txt"
probe "/repos/$R/branches"
probe "/repos/$R/blame/main/data/file-03.txt"
probe "/repos/$R/file/main/data/file-03.txt"
probe "/repos/$R/file/main/README.md"
probe "/repos/$R/compare/$MID...main"
probe "/repos/$R/compare/$FIRST...main"
probe "/repos/$R/audit"
probe "/repos/$R/commits/$MID"
