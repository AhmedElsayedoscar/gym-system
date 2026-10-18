import json, sys
import numpy as np, cv2
data = json.load(open(sys.argv[1]))
det = cv2.QRCodeDetector()
ok = True
for s in data:
    m = np.array(s['modules'], dtype=np.uint8)
    img = np.where(m == 1, 0, 255).astype(np.uint8)
    img = np.pad(img, 4, constant_values=255)
    img = np.kron(img, np.ones((8, 8), dtype=np.uint8))
    val, pts, _ = det.detectAndDecode(img)
    good = (val == s['text'])
    ok &= good
    print(f"v{s['version']} len={len(s['text'])}: {'OK' if good else 'FAIL got=' + repr(val[:40])}")
sys.exit(0 if ok else 1)
