# SplitWise Lite — Expense Splitter MVP

Stack: React + Vite, FastAPI, SQLite, SQLAlchemy.

## Requirements
- Python 3.10+
- Node.js 18+
- npm

## 1. Start the backend
Open a terminal in `expense_splitter_mvp/backend`:

### Windows
```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload
```

If PowerShell blocks activation, use:
```powershell
.\.venv\Scripts\activate.bat
```
from Command Prompt, or run `py -m pip install -r requirements.txt` and `py -m uvicorn main:app --reload`.

### macOS/Linux
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Backend runs at http://127.0.0.1:8000  
Interactive API docs: http://127.0.0.1:8000/docs

## 2. Start the frontend
Open a second terminal in `expense_splitter_mvp/frontend`:

```bash
npm install
npm run dev
```

Open the local URL Vite prints, usually http://localhost:5173.

## How to use
1. Create a group and enter member names separated by commas.
2. Select the group.
3. Add an expense, choose who paid, and submit.
4. View each member's net balance and suggested settlements.
5. Data is saved to `backend/expenses.db`.

## MVP notes
- Expenses are split equally among the members who belong to the group when the expense is created.
- Amounts are stored as integer paise in SQLite to avoid floating-point money errors.
- Settlements are suggestions; this MVP does not move money or process payments.
- No authentication is included in this hackathon MVP. Do not deploy with real personal financial data without adding authentication and authorization.
