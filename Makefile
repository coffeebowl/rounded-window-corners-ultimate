UUID = rounded-window-corners-ultimate@coffeebowl
SRCDIR = extension
ZIP = $(UUID).shell-extension.zip

EXTRA_SOURCES = \
	effect \
	manager \
	patch \
	preferences \
	utils \
	window_picker \
	stylesheet-prefs.css

.PHONY: pack install test smoke pot clean

pack:
	gnome-extensions pack $(SRCDIR) \
		--force \
		--out-dir=. \
		--podir=../po \
		$(addprefix --extra-source=,$(EXTRA_SOURCES))

install: pack
	gnome-extensions install --force $(ZIP)

test:
	@for t in tests/*.test.js; do \
		[ -e "$$t" ] || continue; \
		gjs -m "$$t" || exit 1; \
	done

smoke:
	tests/run-smoke.sh wayland
	tests/run-smoke.sh x11
	RWC_SMOKE_SCRIPT=$(CURDIR)/tests/coverage-smoke.js tests/run-smoke.sh x11

pot:
	xgettext --from-code=UTF-8 \
		--output=po/$(UUID).pot \
		$$(find $(SRCDIR) -name '*.ui' | sort)
	xgettext --from-code=UTF-8 \
		--output=po/$(UUID).pot \
		--language=JavaScript \
		--join-existing \
		$$(find $(SRCDIR) -name '*.js' | sort)
	for file in po/*.po; do \
		msgmerge -q -U --backup=off $$file po/$(UUID).pot; \
	done

clean:
	rm -f $(ZIP)
