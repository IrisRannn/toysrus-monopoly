export default function Dice({
  value = 0,
  rolling = false,
}: {
  value?: number;
  rolling?: boolean;
}) {
  const transforms: Record<number, string> = {
    1: "rotateX(0deg) rotateY(0deg)",
    2: "rotateY(-90deg)",
    3: "rotateX(-90deg)",
    4: "rotateX(90deg)",
    5: "rotateY(90deg)",
    6: "rotateY(180deg)",
  };
  return (
    <div
      className="dice-stage"
      role="img"
      aria-label={rolling ? "骰子滚动中" : `骰子${value}点`}
    >
      <div
        className={"dice-cube " + (rolling ? "rolling" : "")}
        style={{ transform: transforms[value] || transforms[1] }}
      >
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <div className={"dice-face face-" + n} key={n}>
            <span>{["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"][n]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
