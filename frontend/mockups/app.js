const ORDER = [
  "s01","s02","s03","s04","s05","s06","s07","s08","s09","s10",
  "s11","s12","s13","s14","s15","s16","s17","s18","s19","s20","s21"
];

const NAMES = {
  s01: "01 Login",
  s02: "02 Insurance hub",
  s03: "03 Card photo / scan",
  s04: "04 Insurance details",
  s05: "05 Issues / symptoms",
  s06: "06 Doctor suggestions",
  s07: "07 Appointment",
  s08: "08 Doctor visit",
  s09: "09 Transcribing",
  s10: "10 SOAP summary",
  s11: "11 Care plan",
  s12: "12 Follow-ups",
  s13: "13 Reminders",
  s14: "14 Refills",
  s15: "15 History list",
  s16: "16 History detail",
  s17: "17 Share packet",
  s18: "18 Menu",
  s19: "19 Today / Home",
  s20: "20 Coverage",
  s21: "21 Profile"
};

function currentId() {
  const h = (location.hash || "#s01").replace("#", "");
  return ORDER.includes(h) ? h : "s01";
}

function show(id) {
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("hidden", el.id !== id);
  });
  const cap = document.getElementById("cap-name");
  if (cap) cap.textContent = NAMES[id] || id;
  document.title = (NAMES[id] || "CareLoop") + " · mockup";
  const i = ORDER.indexOf(id);
  const prev = document.getElementById("prev");
  const next = document.getElementById("next");
  if (prev) prev.href = "#" + ORDER[(i - 1 + ORDER.length) % ORDER.length];
  if (next) next.href = "#" + ORDER[(i + 1) % ORDER.length];
  const phone = document.getElementById("phone");
  if (phone) phone.scrollTop = 0;
}

function onHash() {
  show(currentId());
}

if (new URLSearchParams(location.search).has("capture")) {
  document.body.classList.add("capture");
  const cap = document.getElementById("caption");
  if (cap) cap.classList.add("hidden");
  const phone = document.getElementById("phone");
  if (phone) phone.classList.add("capture-only");
}

window.addEventListener("hashchange", onHash);
onHash();
