export default function BicepCurl({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 180 285"
      width="150"
      height="238"
      className={className}
      style={{ overflow: "visible" }}
    >
      <style>{`
        .bc-wrap { animation: bc-shake 5s linear infinite; }
        @keyframes bc-shake {
          0%, 71%, 80%, 100% { transform: translateX(0); }
          73% { transform: translateX(-7px); }
          76% { transform: translateX(7px); }
          79% { transform: translateX(-4px); }
        }
        .bc-fore {
          transform-origin: 115px 165px;
          animation: bc-curl 5s linear infinite;
        }
        @keyframes bc-curl {
          0%   { transform: rotate(0deg);    animation-timing-function: ease-in-out; }
          16%  { transform: rotate(105deg);  animation-timing-function: linear; }
          24%  { transform: rotate(105deg);  animation-timing-function: ease-in-out; }
          36%  { transform: rotate(0deg);    animation-timing-function: ease-in-out; }
          52%  { transform: rotate(105deg);  animation-timing-function: linear; }
          64%  { transform: rotate(105deg);  animation-timing-function: ease-in-out; }
          72%  { transform: rotate(0deg); }
          100% { transform: rotate(0deg); }
        }
        .bc-peak { animation: bc-peak-d 5s linear infinite; }
        @keyframes bc-peak-d {
          0%, 36%, 72%, 100% { d: path("M 110,70 C 82,97 78,134 108,165"); }
          16%, 24%           { d: path("M 110,70 C 58,82 54,124 108,165"); }
          52%, 64%           { d: path("M 110,70 C 48,76 44,120 108,165"); }
        }
        .bc-vein {
          stroke-dasharray: 28;
          stroke-dashoffset: 28;
          animation: bc-vein-grow 5s linear infinite;
        }
        .bc-v2 { animation-delay: 0.09s; }
        @keyframes bc-vein-grow {
          0%, 14%, 36%, 50%, 72%, 100% { stroke-dashoffset: 28; opacity: 0; }
          22%, 34%                      { stroke-dashoffset: 0;  opacity: 1; }
          58%, 70%                      { stroke-dashoffset: 0;  opacity: 1; }
        }
      `}</style>

      <g className="bc-wrap">
        {/* Shoulder */}
        <path
          d="M 110,68 C 100,48 120,36 138,50 C 150,58 144,73 130,74"
          stroke="currentColor" fill="none" strokeWidth="2.5" strokeLinecap="round"
        />
        {/* Upper arm — tricep / inner side */}
        <path
          d="M 130,74 C 128,110 124,140 122,165"
          stroke="currentColor" fill="none" strokeWidth="2.5" strokeLinecap="round"
        />
        {/* Upper arm — bicep / outer side, peak morphs on flex */}
        <path
          className="bc-peak"
          d="M 110,70 C 82,97 78,134 108,165"
          stroke="currentColor" fill="none" strokeWidth="2.5" strokeLinecap="round"
        />
        {/* Elbow cap */}
        <path
          d="M 108,165 C 110,172 120,172 122,165"
          stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round"
        />
        {/* Veins — grow in during hold phases */}
        <path className="bc-vein"
          d="M 72,100 C 68,110 66,120 70,131"
          stroke="currentColor" fill="none" strokeWidth="1" strokeLinecap="round"
        />
        <path className="bc-vein bc-v2"
          d="M 78,116 C 74,127 72,137 76,147"
          stroke="currentColor" fill="none" strokeWidth="1" strokeLinecap="round"
        />

        {/* Forearm + hand + dumbbell — all rotate around elbow pivot */}
        <g className="bc-fore">
          {/* Forearm outer */}
          <path
            d="M 108,165 C 106,196 110,226 112,247"
            stroke="currentColor" fill="none" strokeWidth="2.5" strokeLinecap="round"
          />
          {/* Forearm inner */}
          <path
            d="M 122,165 C 124,196 126,226 122,247"
            stroke="currentColor" fill="none" strokeWidth="2.5" strokeLinecap="round"
          />
          {/* Hand */}
          <path
            d="M 112,247 C 108,253 108,261 114,265 L 122,265 C 128,261 126,253 122,247"
            stroke="currentColor" fill="none" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
          />
          {/* Dumbbell bar */}
          <line x1="95" y1="263" x2="141" y2="263"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          />
          {/* Left collar */}
          <rect x="95" y="256" width="5" height="14" rx="1"
            stroke="currentColor" fill="none" strokeWidth="1"
          />
          {/* Left plate */}
          <rect x="82" y="252" width="13" height="22" rx="2"
            stroke="currentColor" fill="none" strokeWidth="1.5"
          />
          {/* Right collar */}
          <rect x="136" y="256" width="5" height="14" rx="1"
            stroke="currentColor" fill="none" strokeWidth="1"
          />
          {/* Right plate */}
          <rect x="141" y="252" width="13" height="22" rx="2"
            stroke="currentColor" fill="none" strokeWidth="1.5"
          />
        </g>
      </g>
    </svg>
  );
}
