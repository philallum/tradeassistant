# Convenience targets. `make check` mirrors the `npm run check` script:
# lint + type-check + tests. The Python cross-check is an isolated,
# deterministic step (Requirement 3.4) run via `make py-check`.

.PHONY: install check lint typecheck test py-install py-check check-all

install:
	npm install

check:
	npm run check

lint:
	npm run lint

typecheck:
	npm run typecheck

test:
	npm run test

py-install:
	python3 -m pip install --require-hashes=false -r python/requirements.txt

py-check:
	python3 -m pytest python/tests

# Full gate including the isolated Python cross-check.
check-all: check py-check
