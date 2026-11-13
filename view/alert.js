"use strict";

/* ------------------------------------------------------------------
   D74 Edits — accessible, DOM-built alert dialog
------------------------------------------------------------------ */

(function () {
  var alertManager = {};
  var queue = [];
  var active = false;

  function dismiss(id) {
    var modal = document.getElementById(id);
    var block = document.getElementById(id + "_BLOCK");
    if (modal) modal.remove();
    if (block) block.remove();
    active = false;
    delete alertManager[id];
    if (queue.length) {
      var next = queue.shift();
      window.alert(next.head, next.msg, next.onclose);
    }
  }

  function alertDialog(head, msg, onclose) {
    head = head == null ? "Notice" : String(head);
    msg = msg == null ? "" : String(msg);

    var id = "ALERT_ID_" + Math.floor(Math.random() * 999999);
    var block = document.createElement("div");
    block.className = "block-div bg-ogrey";
    block.id = id + "_BLOCK";
    block.style.zIndex = "1050";

    var modal = document.createElement("div");
    modal.className = "alert-modal";
    modal.id = id;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    var heading = document.createElement("div");
    heading.className = "alert-head";
    heading.textContent = head;

    var body = document.createElement("div");
    body.className = "alert-body";
    body.textContent = msg;

    var action = document.createElement("button");
    action.type = "button";
    action.className = "alert-right";
    action.textContent = "CONTINUE";

    modal.append(heading, body, action);
    document.body.append(block, modal);

    alertManager[id] = function () {
      dismiss(id);
      if (typeof onclose === "function") onclose();
    };
    action.addEventListener("click", alertManager[id]);
    block.addEventListener("click", alertManager[id]);
    action.focus();

    return id;
  }

  window.alert = function (head, msg, onclose) {
    if (arguments.length === 1) {
      msg = head;
      head = "Notice";
      onclose = undefined;
    }
    if (active) {
      queue.push({ head: head, msg: msg, onclose: onclose });
      return;
    }
    active = true;
    alertDialog(head, msg, onclose);
  };
  window.alertManager = alertManager;
})();
