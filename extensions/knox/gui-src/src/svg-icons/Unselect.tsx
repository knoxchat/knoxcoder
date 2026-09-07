import IconWrapper from "./Wrapper";

const RawIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 15L15 9" />
    <path d="M9 9l6 6" />
  </svg>
);

export default IconWrapper(RawIcon); 