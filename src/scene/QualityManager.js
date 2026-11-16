const ORDER = ['low', 'medium', 'high'];

export class QualityManager {
  constructor(tiers, initial, onChange) {
    this.tiers = tiers;
    this.current = initial;
    this.onChange = onChange;
    this.elapsed = 0;
    this.frames = 0;
    this.cooldown = 4;
  }

  update(dt) {
    this.elapsed += dt;
    this.frames += 1;
    this.cooldown = Math.max(0, this.cooldown - dt);

    if (this.elapsed < 2.5) return;
    const fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;

    if (this.cooldown > 0) return;
    if (fps >= 45) return;

    const index = ORDER.indexOf(this.current.label);
    const next = this.tiers[ORDER[Math.max(0, index - 1)]];
    if (!next || next === this.current) return;

    this.current = next;
    this.cooldown = 5;
    this.onChange(next);
  }
}
