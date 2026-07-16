!macro NSIS_HOOK_PREINSTALL
  IfFileExists "$EXEDIR\models\large-v3-turbo\model.bin" batch6_model_found
  MessageBox MB_ICONSTOP|MB_OK "WhisperSubtitle offline model pack is missing. Keep the setup executable beside models\large-v3-turbo and run setup again."
  Abort
batch6_model_found:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$INSTDIR\models\large-v3-turbo"
  CopyFiles /SILENT "$EXEDIR\models\large-v3-turbo\*.*" "$INSTDIR\models\large-v3-turbo"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  RMDir /r "$INSTDIR\models\large-v3-turbo"
  RMDir "$INSTDIR\models"
!macroend
