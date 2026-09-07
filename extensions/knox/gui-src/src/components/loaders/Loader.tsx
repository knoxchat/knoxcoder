import { PlayIcon } from "../../svg-icons";

const DEFAULT_SIZE = "28px";

function Loader(_props: { size?: string }) {
  return (
    <div 
      className="mt-4 mx-auto animate-flash"
      style={{ width: DEFAULT_SIZE }}
    >
      <PlayIcon />
    </div>
  );
}

export default Loader;
