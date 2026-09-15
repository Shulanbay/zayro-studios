export default function EquipmentSection() {
  const equipment = [
    { category: 'Cameras', items: ['Sony FX30 (4K Cinema)', 'Sony A7IV (4K Mirrorless)', 'GoPro Hero 12 (B-Cam)'] },
    { category: 'Audio', items: ['Shure SM7B (Host)', 'Shure SM7B (Guest)', 'RØDECaster Pro II (Mixing)', 'Sennheiser e904 (Instrument)'] },
    { category: 'Lighting', items: ['Nanlite Forza 60', 'Aputure MC4s', 'Neewer Ring Light Kit'] },
    { category: 'Backdrop', items: ['Professional Green Screen', 'Custom Studio Backdrop', 'Window Backdrop'] },
  ];

  return (
    <section className="py-16 md:py-24 bg-white">
      <div className="container">
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Professional Equipment
          </h2>
          <p className="text-xl text-zayro-gray max-w-2xl mx-auto">
            Industry-standard gear for broadcast-quality production
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {equipment.map((group, idx) => (
            <div key={idx} className="card">
              <h3 className="text-lg font-semibold mb-4 text-zayro-primary">{group.category}</h3>
              <ul className="space-y-2">
                {group.items.map((item, aidx) => (
                  <li key={aidx} className="text-zayro-gray text-sm">
                    • {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
