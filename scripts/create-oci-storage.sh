#!/usr/bin/env bash
# Copyright (c) 2026 jiongjiong123441. All rights reserved.
# Licensed under PolyForm Noncommercial 1.0.0.
# Keep this notice and the LICENSE file with all copies and modified versions.
set -euo pipefail
: "${OCI_COMPARTMENT_ID:?Set OCI_COMPARTMENT_ID}"
: "${OCI_REGION:?Set OCI_REGION}"
: "${OCI_NAMESPACE:?Set OCI_NAMESPACE}"
: "${OCI_MEDIA_BUCKET:?Set OCI_MEDIA_BUCKET}"
: "${OCI_PRIVATE_BUCKET:?Set OCI_PRIVATE_BUCKET}"
: "${OCI_ARCHIVE_BUCKET:?Set OCI_ARCHIVE_BUCKET}"
for bucket_kind in media private archive; do
  case "$bucket_kind" in
    media) bucket_name="$OCI_MEDIA_BUCKET"; bucket_tier=Standard ;;
    private) bucket_name="$OCI_PRIVATE_BUCKET"; bucket_tier=Standard ;;
    archive) bucket_name="$OCI_ARCHIVE_BUCKET"; bucket_tier=Archive ;;
  esac
  if oci os bucket get --region "$OCI_REGION" --namespace-name "$OCI_NAMESPACE" --name "$bucket_name" > /dev/null 2>&1; then
    existing_tier=$(oci os bucket get --region "$OCI_REGION" --namespace-name "$OCI_NAMESPACE" --name "$bucket_name" --query 'data."storage-tier"' --raw-output)
    existing_access=$(oci os bucket get --region "$OCI_REGION" --namespace-name "$OCI_NAMESPACE" --name "$bucket_name" --query 'data."public-access-type"' --raw-output)
    if [[ "$existing_tier" != "$bucket_tier" || "$existing_access" != NoPublicAccess ]]; then
      echo "Bucket $bucket_name must be private and use $bucket_tier tier" >&2
      exit 1
    fi
  else
    oci os bucket create --region "$OCI_REGION" --namespace-name "$OCI_NAMESPACE" --compartment-id "$OCI_COMPARTMENT_ID" --name "$bucket_name" --storage-tier "$bucket_tier" --public-access-type NoPublicAccess > /dev/null
  fi
  echo "Ready: $bucket_name ($bucket_tier, private)"
done
