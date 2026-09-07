import { useDispatch } from "react-redux";
import { useTranslation } from "react-i18next";

import { Button, SecondaryButton } from "..";
import { setDialogMessage, setShowDialog } from "../../redux/slices/uiSlice";

interface ConfirmationDialogProps {
  onConfirm: () => void;
  onCancel?: () => void;
  text: string;
  title?: string;
  hideCancelButton?: boolean;
  confirmText?: string;
}

function ConfirmationDialog(props: ConfirmationDialogProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();

  return (
    <div className="p-4 pt-0">
      <h4 className="mb-1 text-center text-xl">
        {props.title ?? t('confirm')}
      </h4>
      <p className="text-center text-base" style={{ whiteSpace: "pre-wrap" }}>
        {props.text}
      </p>

      <div className="w/1/2 flex justify-end gap-2">
        {!!props.hideCancelButton || (
          <SecondaryButton
            className="text-lightgray"
            onClick={() => {
              dispatch(setShowDialog(false));
              dispatch(setDialogMessage(undefined));
              props.onCancel?.();
            }}
          >
            Cancel
          </SecondaryButton>
        )}
        <Button
          onClick={() => {
            props.onConfirm();
            dispatch(setShowDialog(false));
            dispatch(setDialogMessage(undefined));
          }}
        >
          {props.confirmText ?? t('confirm')}
        </Button>
      </div>
    </div>
  );
}

export default ConfirmationDialog;
