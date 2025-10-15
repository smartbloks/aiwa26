/**
 * Custom Domain Dialog Component
 * Allows users to add, verify, and remove custom domains for their apps
 */

import { useState, useEffect } from 'react';
import { Globe, Check, AlertCircle, Loader2, Trash2, RefreshCw, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { apiClient } from '@/lib/api-client';
import { toast } from 'sonner';

interface CustomDomainDialogProps {
  isOpen: boolean;
  onClose: () => void;
  appId: string;
}

// Unified interface that can hold data from both add and status endpoints
interface CustomDomainData {
  hostname: string;
  status: string;
  sslStatus?: string;
  customHostnameId?: string;
  verificationInstructions?: {
    type: string;
    name: string;
    target: string;
    instructions: string;
  };
  verificationErrors?: string[];
  isActive?: boolean;
}

export function CustomDomainDialog({ isOpen, onClose, appId }: CustomDomainDialogProps) {
  const [hostname, setHostname] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [customDomain, setCustomDomain] = useState<CustomDomainData | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Load existing custom domain on mount
  useEffect(() => {
    if (isOpen && appId) {
      loadCustomDomain();
    }
  }, [isOpen, appId]);

  const loadCustomDomain = async () => {
    try {
      const response = await apiClient.getCustomDomainStatus(appId);
      if (response.data) {
        setCustomDomain(response.data);
      }
    } catch (error) {
      // No custom domain configured, which is fine
      setCustomDomain(null);
    }
  };

  const handleAddDomain = async () => {
    if (!hostname.trim()) {
      toast.error('Please enter a domain name');
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiClient.addCustomDomain(appId, hostname.trim());

      if (response.data) {
        // Response from addCustomDomain has verificationInstructions
        setCustomDomain(response.data);
        setHostname('');
        toast.success('Custom domain added successfully!');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add custom domain');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckStatus = async () => {
    if (!customDomain?.hostname) return;

    setIsCheckingStatus(true);
    try {
      const response = await apiClient.getCustomDomainStatus(appId);

      if (response.data) {
        // Merge the new status data with existing verificationInstructions if present
        setCustomDomain({
          ...response.data,
          // Preserve verificationInstructions from the add response if they exist
          verificationInstructions: customDomain.verificationInstructions || {
            type: 'CNAME',
            name: response.data.hostname,
            target: '', // Will be shown from env or default
            instructions: '',
          },
        });

        if (response.data.isActive) {
          toast.success('Domain is active and verified!');
        } else {
          toast.info(`Domain status: ${response.data.status}`);
        }
      }
    } catch (error) {
      toast.error('Failed to check domain status');
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const handleRemoveDomain = async () => {
    setIsLoading(true);
    try {
      await apiClient.removeCustomDomain(appId);

      setCustomDomain(null);
      setShowDeleteConfirm(false);
      toast.success('Custom domain removed successfully');
    } catch (error) {
      toast.error('Failed to remove custom domain');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard!');
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      active: { label: 'Active', variant: 'default' },
      pending: { label: 'Pending', variant: 'secondary' },
      failed: { label: 'Failed', variant: 'destructive' },
      moved: { label: 'Moved', variant: 'outline' },
    };

    const config = statusConfig[status] || { label: status, variant: 'outline' };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Globe className="size-5 text-orange-500" />
              <DialogTitle>Custom Domain</DialogTitle>
            </div>
            <DialogDescription>
              Connect your own domain to this app. Your domain will point to your deployed application.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {!customDomain ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="hostname">Domain Name</Label>
                  <Input
                    id="hostname"
                    placeholder="app.yourdomain.com"
                    value={hostname}
                    onChange={(e) => setHostname(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAddDomain();
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter your custom domain (e.g., app.yourdomain.com)
                  </p>
                </div>

                <Alert>
                  <AlertCircle className="size-4" />
                  <AlertDescription>
                    <strong>Before adding:</strong> Make sure you have access to your domain's DNS settings.
                    You'll need to add a CNAME record after adding the domain.
                  </AlertDescription>
                </Alert>
              </>
            ) : (
              <>
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Globe className="size-4 text-muted-foreground" />
                      <span className="font-medium">{customDomain.hostname}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(customDomain.status)}
                      {customDomain.sslStatus && (
                        <Badge variant="outline" className="text-xs">
                          SSL: {customDomain.sslStatus}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {customDomain.status !== 'active' && customDomain.verificationInstructions && (
                    <div className="bg-muted/50 rounded-md p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="size-4 mt-0.5 text-orange-500" />
                        <div className="space-y-1 flex-1">
                          <p className="text-sm font-medium">DNS Configuration Required</p>
                          <p className="text-xs text-muted-foreground">
                            Add the following CNAME record to your DNS:
                          </p>
                          <div className="bg-background rounded border p-2 mt-2">
                            <div className="grid grid-cols-[80px_1fr_auto] gap-2 text-xs font-mono">
                              <span className="text-muted-foreground">Type:</span>
                              <span>CNAME</span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0"
                                onClick={() => copyToClipboard('CNAME')}
                              >
                                <Copy className="size-3" />
                              </Button>
                            </div>
                            <div className="grid grid-cols-[80px_1fr_auto] gap-2 text-xs font-mono mt-1">
                              <span className="text-muted-foreground">Name:</span>
                              <span className="truncate">{customDomain.hostname}</span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0"
                                onClick={() => copyToClipboard(customDomain.hostname)}
                              >
                                <Copy className="size-3" />
                              </Button>
                            </div>
                            <div className="grid grid-cols-[80px_1fr_auto] gap-2 text-xs font-mono mt-1">
                              <span className="text-muted-foreground">Target:</span>
                              <span className="truncate">
                                {customDomain.verificationInstructions.target}
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0"
                                onClick={() =>
                                  copyToClipboard(customDomain.verificationInstructions?.target || '')
                                }
                              >
                                <Copy className="size-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {customDomain.isActive && (
                    <Alert>
                      <Check className="size-4" />
                      <AlertDescription>
                        Your custom domain is active and ready to use! Visit{' '}
                        <a
                          href={`https://${customDomain.hostname}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium underline inline-flex items-center gap-1"
                        >
                          {customDomain.hostname}
                          <ExternalLink className="size-3" />
                        </a>
                      </AlertDescription>
                    </Alert>
                  )}

                  {customDomain.verificationErrors && customDomain.verificationErrors.length > 0 && (
                    <Alert variant="destructive">
                      <AlertCircle className="size-4" />
                      <AlertDescription>
                        <strong>Verification Issues:</strong>
                        <ul className="list-disc list-inside mt-1 text-xs">
                          {customDomain.verificationErrors.map((error, index) => (
                            <li key={index}>{error}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCheckStatus}
                    disabled={isCheckingStatus}
                    className="flex-1"
                  >
                    {isCheckingStatus ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" />
                        Checking...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="size-4 mr-2" />
                        Refresh Status
                      </>
                    )}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Trash2 className="size-4 mr-2" />
                    Remove
                  </Button>
                </div>
              </>
            )}
          </div>

          {!customDomain && (
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleAddDomain} disabled={isLoading || !hostname.trim()}>
                {isLoading ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  'Add Domain'
                )}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Custom Domain?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {customDomain?.hostname} from this app. Your app will no longer be
              accessible via this domain. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveDomain} disabled={isLoading}>
              {isLoading ? 'Removing...' : 'Remove Domain'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
