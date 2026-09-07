import IconWrapper from "./Wrapper";

const RawIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 3 24 24"
  >
    <g fill="none" stroke="#159994" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" strokeLinecap="round" />
      <path strokeWidth="1.5" d="M12 8h.01v.01H12z" />
      <path strokeLinecap="round" d="M12 12v4" />
    </g>
  </svg>
);

export default IconWrapper(RawIcon);
