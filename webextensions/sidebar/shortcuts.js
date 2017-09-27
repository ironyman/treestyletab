chrome.commands.onCommand.addListener(function(command) {
	const commands = {
		tab_go_prev: function() {
      selectTabInternally(getPreviousSiblingTab(getCurrentTab()));
    },
    tab_go_next: function() {
      selectTabInternally(getNextSiblingTab(getCurrentTab()));
    },
    tab_go_parent: function() {
      selectTabInternally(getParentTab(getCurrentTab()));
    },
    tab_go_child: function() {
      selectTabInternally(getFirstChildTab(getCurrentTab()));
    },
    tab_move_prev: function() {
      var t = getCurrentTab();
      moveTabsInternallyBefore([t].concat(getDescendantTabs(t)),
        getPreviousSiblingTab(t));
    },
    tab_move_next: function() {
      var t = getCurrentTab();
      var s = getNextSiblingTab(t);
      var lastTabOfSibling = getLastDescendantTab(s) || s;
      moveTabsInternallyAfter([t].concat(getDescendantTabs(t)),
        lastTabOfSibling);
    },
    tab_move_parent: function() {
      var t = getCurrentTab();
      var p = getParentTab(t);

      if (!p) return;

      var gp = getParentTab(p);
      if (gp)
        attachTabTo(t, gp);
      else
        detachTab(t);
    },
    tab_move_child: function() {
      var t = getCurrentTab();
      var s = getPreviousSiblingTab(t)
      if (s)
        attachTabTo(t, s);
    },
  };
  commands[command]();
});
