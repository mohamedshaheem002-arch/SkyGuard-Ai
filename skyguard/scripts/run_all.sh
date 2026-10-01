#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
python3 -u scripts/prepare.py 2>&1 | grep -v Warning | grep -v "out\[" | grep -v nanmedian | grep -E "features:|genuine|done|Error|error" 
python3 -u scripts/train.py 2>&1 | grep -v Warning | grep -v "eval_set = " | grep -v "ev_tab = " | grep -E "theta|TEST|root-cause acc|per-fault|FP from|genuine|saved|Error|error"
echo PIPELINE_DONE
