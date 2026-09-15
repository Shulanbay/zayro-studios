export default function EquipmentSection() {
  const equipment = [
    {
      category: 'Cameras',
      items: ['Sony FX30 (4K Cinema)', 'Sony A7IV (4K Mirrorless)', 'GoPro Hero 12 (B-Cam)']
    },
    {
      category: 'Audio',
      items: ['Shure SM7B (Host)', 'Shure SM7B (Guest)', 'RØDECaster Pro II', 'Sennheiser e904']
    },
    {
      category: 'Lighting',
      items: ['Nanlite Forza 60', 'Aputure MC4s', 'Neewer Ring Light Kit']
    },
    {
      category: 'Backdrop',
      items: ['Professional Green Screen', 'Custom Studio Backdrop', 'Window Backdrop']
    },
  ];

  return (
    <section className="section-padding bg-white">
      <div className="container max-w-5xl">
        <h2 className="text-5xl md:text-7xl font-black mb-4 text-zayro-dark">
          PROFESSIONAL<br/>EQUIPMENT
        </h2>
        <p className="text-xl text-zayro-gray font-light mb-16 max-w-2xl">
          Industry-standard gear for broadcast-quality production.
        </p>

        {/* Equipment in editorial grid, not cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          {equipment.map((group, idx) => (
            <div key={idx} className="border-l-2 border-zayro-primary pl-6">
              <h3 className="text-2xl font-black text-zayro-dark mb-6">{group.category}</h3>
              <ul className="space-y-3">
                {group.items.map((item, aidx) => (
                  <li key={aidx} className="text-zayro-gray leading-relaxed">
                    {item}
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
