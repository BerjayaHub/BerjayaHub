// Uji aturan "tanpa penugasan = berlaku di semua sesi" (migration 0069).
//
// Aturan implisit adalah yang paling mudah salah dipahami, jadi dikunci di sini:
// mengubahnya tanpa sengaja akan mengosongkan ceklis orang, dan gejalanya
// bukan error melainkan staff yang mengira pekerjaannya tidak perlu dilakukan.
function saring(items, tugas, sessionId) {
  if (!sessionId) return items;
  const punyaTugas = new Set(tugas.map((t) => t.item_id));
  const untukSesi = new Set(tugas.filter((t) => t.session_id === sessionId).map((t) => t.item_id));
  return items.filter((i) => !punyaTugas.has(i.id) || untukSesi.has(i.id));
}

const items = [
  { id: 'i1', label: 'Pel lantai' },
  { id: 'i2', label: 'Cek stok' },
  { id: 'i3', label: 'Tutup kasir' },
  { id: 'i4', label: 'Buka tirai' }
];
const tugas = [
  { item_id: 'i1', session_id: 'pagi' },
  { item_id: 'i3', session_id: 'malam' },
  { item_id: 'i4', session_id: 'pagi' }
  // i2 sengaja tanpa penugasan -> harus muncul di semua sesi
];

const kasus = [
  ['pagi', ['i1', 'i2', 'i4'], 'sesi pagi: item pagi + item tanpa penugasan'],
  ['malam', ['i2', 'i3'], 'sesi malam: item malam + item tanpa penugasan'],
  ['siang', ['i2'], 'sesi yang tidak punya item khusus tetap dapat item umum'],
  [null, ['i1', 'i2', 'i3', 'i4'], 'tanpa sessionId (layar admin) -> semua item']
];

let gagal = 0;
for (const [sesi, harap, ket] of kasus) {
  const hasil = saring(items, tugas, sesi).map((i) => i.id);
  const ok = JSON.stringify(hasil) === JSON.stringify(harap);
  if (!ok) gagal++;
  console.log(`${ok ? '✓' : '✗'} ${String(sesi ?? '(semua)').padEnd(8)} -> [${hasil}] · ${ket}`);
}

// Item yang ditugaskan ke DUA sesi muncul di keduanya — inilah alasan relasinya
// banyak-ke-banyak, bukan satu kolom session_id.
const tugas2 = [...tugas, { item_id: 'i2', session_id: 'pagi' }, { item_id: 'i2', session_id: 'malam' }];
for (const [sesi, harus] of [['pagi', true], ['malam', true], ['siang', false]]) {
  const ada = saring(items, tugas2, sesi).some((i) => i.id === 'i2');
  const ok = ada === harus;
  if (!ok) gagal++;
  console.log(`${ok ? '✓' : '✗'} item dua sesi di "${sesi}" -> ${ada ? 'muncul' : 'tidak muncul'}`);
}

if (gagal) { console.error(`\n${gagal} kasus item-per-sesi salah.`); process.exit(1); }
console.log('\nAturan item per sesi benar untuk 7 kasus, termasuk "tanpa penugasan = semua sesi". ✅');
