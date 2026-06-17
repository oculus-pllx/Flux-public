.PHONY: help install dev start stop logs clean reset build docker-up docker-down electron-dev electron-build electron-build-win electron-build-linux

help:
	@echo "🔋 NUT Monitor - Available Commands"
	@echo ""
	@echo "Setup & Installation:"
	@echo "  make install          - Install all dependencies (backend + frontend)"
	@echo "  make setup            - Copy .env.example to .env"
	@echo ""
	@echo "Development:"
	@echo "  make dev              - Start backend & frontend in dev mode (requires 2 terminals)"
	@echo "  make dev-backend      - Start backend only (npm run dev)"
	@echo "  make dev-frontend     - Start frontend only (npm run dev)"
	@echo ""
	@echo "Docker:"
	@echo "  make docker-up        - Start with Docker Compose (docker-compose up -d)"
	@echo "  make docker-rebuild   - Rebuild images and restart (after pulling new code)"
	@echo "  make docker-down      - Stop Docker containers (docker-compose down)"
	@echo "  make docker-logs      - View backend logs (docker logs -f)"
	@echo "  make docker-reset     - Reset Docker (down + remove DB + up)"
	@echo ""
	@echo "Building:"
	@echo "  make build            - Build for production (npm run build)"
	@echo "  make build-backend    - Build backend Docker image"
	@echo "  make build-frontend   - Build frontend Docker image"
	@echo ""
	@echo "Electron Desktop:"
	@echo "  make electron-dev         - Launch Electron in dev mode (run dev servers first)"
	@echo "  make electron-build       - Build desktop app for current platform"
	@echo "  make electron-build-win   - Build Windows installer (.exe)"
	@echo "  make electron-build-linux - Build Linux packages (.AppImage + .deb)"
	@echo ""
	@echo "Utilities:"
	@echo "  make logs             - View logs (requires Docker)"
	@echo "  make clean            - Clean node_modules and build files"
	@echo "  make reset            - Full reset (delete DB, node_modules)"
	@echo "  make health           - Check API health"
	@echo ""
	@echo "Database:"
	@echo "  make backup           - Backup database to nut-monitor.db.backup"
	@echo "  make restore          - Restore database from backup"
	@echo ""

install:
	@echo "📦 Installing dependencies..."
	npm install
	cd backend && npm install
	cd frontend && npm install
	@echo "✅ Dependencies installed!"

electron-dev:
	@echo "🖥️  Starting Electron (dev mode)..."
	@echo "Requires: make dev-backend and make dev-frontend running first"
	npm run electron:dev

electron-build:
	@echo "📦 Building Electron app (current platform)..."
	npm run electron:build
	@echo "✅ Output in dist-electron/"

electron-build-win:
	@echo "📦 Building Electron app for Windows..."
	npm run electron:build:win
	@echo "✅ Output in dist-electron/"

electron-build-linux:
	@echo "📦 Building Electron app for Linux..."
	npm run electron:build:linux
	@echo "✅ Output in dist-electron/"

setup:
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "✅ .env file created (edit as needed)"; \
	else \
		echo "⚠️  .env already exists"; \
	fi

dev:
	@echo "🚀 Starting development servers..."
	@echo "Terminal 1: Backend (npm run dev)"
	@echo "Terminal 2: Frontend (npm run dev)"
	@echo ""
	@echo "Run in separate terminals:"
	@echo "  make dev-backend"
	@echo "  make dev-frontend"

dev-backend:
	cd backend && npm run dev

dev-frontend:
	cd frontend && npm run dev

docker-up:
	@echo "🐳 Starting Docker Compose..."
	docker-compose up -d
	@echo "✅ Services starting..."
	@echo "   Frontend: http://localhost:3000"
	@echo "   Backend:  http://localhost:5000"
	@sleep 2
	@make health

docker-rebuild:
	@echo "🔄 Rebuilding and restarting Docker Compose..."
	docker-compose down
	docker-compose up -d --build
	@echo "✅ Services rebuilt and starting..."
	@echo "   Frontend: http://localhost:3000"
	@echo "   Backend:  http://localhost:5000"

docker-down:
	@echo "🛑 Stopping Docker Compose..."
	docker-compose down
	@echo "✅ Services stopped"

docker-logs:
	docker logs -f flux-backend

docker-reset:
	@echo "🔄 Resetting Docker (this deletes all data)..."
	@read -p "Are you sure? (yes/no) " -n 3 -r; \
	echo ""; \
	if [[ $$REPLY =~ ^[Yy][Ee][Ss]$$ ]]; then \
		docker-compose down; \
		rm -f backend/data/flux.db; \
		docker-compose up -d; \
		echo "✅ Reset complete"; \
	else \
		echo "❌ Cancelled"; \
	fi

build:
	@echo "🔨 Building for production..."
	cd frontend && npm run build
	@echo "✅ Frontend built!"

build-backend:
	docker build -t nut-monitor-backend:latest ./backend

build-frontend:
	docker build -t nut-monitor-frontend:latest ./frontend

deb:
	@echo "📦 Building .deb package..."
	bash packaging/deb/build.sh
	@echo "✅ Done"

logs:
	@echo "📋 Backend logs:"
	docker logs nut-monitor-backend

clean:
	@echo "🧹 Cleaning up..."
	rm -rf backend/node_modules
	rm -rf frontend/node_modules
	rm -rf frontend/dist
	@echo "✅ Clean complete"

reset:
	@echo "🔄 Full reset (this deletes everything)..."
	@read -p "Are you sure? (yes/no) " -n 3 -r; \
	echo ""; \
	if [[ $$REPLY =~ ^[Yy][Ee][Ss]$$ ]]; then \
		make clean; \
		rm -rf backend/data/nut-monitor.db; \
		make install; \
		echo "✅ Reset complete. Run 'make docker-up' to start"; \
	else \
		echo "❌ Cancelled"; \
	fi

health:
	@echo "🏥 Checking API health..."
	@curl -s http://localhost:5174/api/health | jq . || echo "❌ API not responding"

backup:
	@echo "💾 Backing up database..."
	cp backend/data/flux.db backend/data/flux.db.backup
	@echo "✅ Backup created: backend/data/flux.db.backup"

restore:
	@echo "📥 Restoring from backup..."
	cp backend/data/flux.db.backup backend/data/flux.db
	@echo "✅ Database restored"

build-installer-win:
	@echo "📦 Building Windows installer..."
	npm run build:frontend
	npm run build:service:win
	npm run build:tray:win
	npm run build:installer:win
	@echo "✅ Output: dist-installer/Flux-Setup.exe"

build-installer-linux:
	@echo "📦 Building Linux .deb package..."
	npm run build:frontend
	npm run build:installer:linux
	@echo "✅ Output: dist-installer/flux_1.0.0_amd64.deb"

service-status:
	@systemctl status flux --no-pager 2>/dev/null || sc query FluxUPS 2>/dev/null || echo "Service not found"

service-logs:
	@journalctl -u flux -f --no-pager 2>/dev/null || echo "journalctl not available"

ps:
	@echo "📦 Running containers:"
	docker-compose ps

version:
	@grep '"version"' package.json | head -1

.SILENT: help
