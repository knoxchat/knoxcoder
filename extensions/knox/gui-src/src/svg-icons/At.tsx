import IconWrapper from "./Wrapper";

const RawIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
  >
    <g
      fill="none"
      stroke="#159994"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1"
    >
      <rect width="20" height="20" x="2" y="2" rx="2" />
      <path d="M14 17.7a6 6 0 1 1 4-5.7a2 2 0 0 1-4 0" />
      <circle cx="12" cy="12" r="2" />
    </g>
  </svg>
);

export default IconWrapper(RawIcon);
