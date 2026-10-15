import fs from 'fs';
import path from 'path';

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (file === 'node_modules' || file === '.git' || file === 'dist') continue;
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(fullPath));
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = walk('src');
const hookPattern = /\b(useState|useEffect|useMemo|useCallback|useRef|useContext|useQuery|useMutation|useId|useSearchParams|useNavigate|useParams)\s*[(<]/;

for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  let hasEarlyReturn = false;
  let earlyReturnLine = -1;
  let depth = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // check if function declaration
    if (/^\s*(export\s+default\s+)?function\s+[A-Z]/.test(line) || /^\s*(const|let)\s+[A-Z]\w*\s*=\s*(react\.)?(memo|forwardRef)?\s*\(?\(/.test(line)) {
      hasEarlyReturn = false;
      earlyReturnLine = -1;
    }
    
    // check early return
    if (/^\s*if\s*\(.+\)\s*return\b/.test(line) || (/^\s*if\s*\(/.test(line) && lines.slice(i, i+3).some(l => /return\s+<|return\s+null|return\s+\(/.test(l)))) {
      hasEarlyReturn = true;
      earlyReturnLine = i + 1;
    }
    
    if (hasEarlyReturn && hookPattern.test(line)) {
      // Check if this hook is inside the same function
      console.log(`POTENTIAL EARLY RETURN BEFORE HOOK: ${f}:${i + 1} (early return at ${earlyReturnLine}) -> ${line.trim()}`);
    }

    // Check hook inside if statement
    if (/^\s*if\s*\(/.test(line) && hookPattern.test(line)) {
      console.log(`CONDITIONAL HOOK: ${f}:${i + 1} -> ${line.trim()}`);
    }
  }
}
