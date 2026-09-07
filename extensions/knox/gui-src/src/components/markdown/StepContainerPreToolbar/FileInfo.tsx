import ClickableFilePath from "../ClickableFilePath";

export interface FileInfoProps {
  relativeFilepath: string;
  range?: string;
}

const FileInfo = ({ relativeFilepath, range }: FileInfoProps) => {
  return (
    <div className="flex w-full min-w-0 items-center">
      <ClickableFilePath
        filepath={relativeFilepath}
        range={range}
        showIcon
        iconSize="20px"
        className="mr-0.5 w-full"
        nameClassName="font-medium"
      />
    </div>
  );
};

export default FileInfo;
