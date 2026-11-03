# Convenience targets. `make check` mirrors the `npm run check` script:
# lint + type-check + tests. The authoritative verification of the
# confidence-shrinkage formula is the TypeScript property test
# (`src/confidence/`); there is no separate language toolchain.

.PHONY: install check check-web lint typecheck test

install:
	npm install

check:
	npm run check
	$(MAKE) check-web

check-web:
	cd web && npm run build && npm test

lint:
	npm run lint

typecheck:
	npm run typecheck

test:
	npm run test
