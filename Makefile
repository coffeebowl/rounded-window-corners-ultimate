UUID = rounded-window-corners@fxgn
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

.PHONY: pack install pot clean

pack:
	gnome-extensions pack $(SRCDIR) \
		--force \
		--out-dir=. \
		--podir=../po \
		$(addprefix --extra-source=,$(EXTRA_SOURCES))

install: pack
	gnome-extensions install --force $(ZIP)

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
